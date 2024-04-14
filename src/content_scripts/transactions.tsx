import {
    AccountRoleProperty,
    TransactionRead,
    TransactionSplitStore,
    TransactionStore,
    TransactionTypeProperty
} from "firefly-iii-typescript-sdk-fetch";
import {AutoRunState} from "../background/auto_state";
import {
    getButtonDestination,
    getCurrentPageAccount,
    getRowAmount,
    getRowDate,
    getRowDesc,
    getRowElements,
    isPageReadyForScraping,
    getPageNum
} from "./scrape/transactions";
import {PageAccount} from "../common/accounts";
import {runOnURLMatch} from "../common/buttons";
import {runOnContentChange} from "../common/autorun";
import {AccountRead} from "firefly-iii-typescript-sdk-fetch/dist/models/AccountRead";
import {allowFuzzyDates, debugAutoRun, isSingleAccountBank, transactionsPerPage} from "../extensionid";
import {backToAccountsPage} from "./auto_run/transactions";
import {debugLog, showDebug} from "./auto_run/debug";
import {FireflyTransactionUIAdder, MetaTx} from "./scan/transactions";

// TODO: You will need to update manifest.json so this file will be loaded on
//  the correct URL.

interface TransactionScrape {
    pageAccount: PageAccount;
    pageTransactions: TransactionStore[];
}

let pageAlreadyScraped = false;

const queuedTxs: {
    [page: number]: TxPageScan[]
} = {};

export interface TxPageScrape {
    tx: TransactionStore,
    row: Element,
    pageNum: number
}

export interface TxPageScan extends TxPageScrape {
  status: 'unknown' | 'local' | 'remote' | 'both';
}

/**
 * @param pageAccount The Firefly III account for the current page
 */
export function scrapeTransactionsFromPage(
    pageAccount: AccountRead,
): { pageNum: number, txs: TxPageScrape[] } {
    const rows = getRowElements();
    const pageNum = getPageNum();
    return {
        pageNum: pageNum, txs: rows.map((r, idx) => {
            let tType = TransactionTypeProperty.Deposit;
            let srcId: string | undefined = undefined;
            let destId: string | undefined = pageAccount.id;


            let returnVal;
            try {
                const amount = getRowAmount(r, pageAccount);
                if (amount < 0) {
                    tType = TransactionTypeProperty.Withdrawal;
                    srcId = pageAccount.id;
                    destId = undefined;
                }
                let newTX = {
                    type: tType,
                    date: getRowDate(r),
                    amount: `${Math.abs(amount)}`,
                    description: getRowDesc(r)?.trim(),
                    destinationId: destId,
                    sourceId: srcId
                };
                setTimeout(() => {
                    showDebug(
                        "Scraped transactions, including row "
                        + idx + ":\n" + JSON.stringify(newTX, undefined, '\t')
                    );
                })
                returnVal = {
                    tx: {
                        errorIfDuplicateHash: true,
                        applyRules: true,
                        transactions: [newTX],
                    },
                    row: r,
                    pageNum: pageNum,
                };
            } catch (e: any) {
                if (debugAutoRun) {
                    setTimeout(() => {
                        showDebug(
                            "Tried to scrape transaction, but encountered error on row "
                            + idx + ":\n" + e.message,
                        );
                    })
                }
                throw e;
            }
            return returnVal;
        })
    };
}

async function doScrape(isAutoRun: boolean): Promise<TransactionScrape> {
    if (isAutoRun && pageAlreadyScraped) {
        throw new Error("Already scraped. Stopping.");
    }

    const accounts = await chrome.runtime.sendMessage({
        action: "list_accounts",
    });
    const acct = await getCurrentPageAccount(accounts);
    const txs = scrapeTransactionsFromPage(acct).txs;
    pageAlreadyScraped = true;
    const txOnly = txs.map(v => v.tx);
    if (!debugAutoRun) {
        await chrome.runtime.sendMessage({
                action: "store_transactions",
                is_auto_run: isAutoRun,
                value: txOnly,
            },
            () => {
            });
    }
    if (isSingleAccountBank) {
        await chrome.runtime.sendMessage({
            action: "complete_auto_run_state",
            state: AutoRunState.Transactions,
        });
    }
    return {
        pageAccount: {
            accountNumber: acct.attributes.accountNumber!,
            name: acct.attributes.name,
            id: acct.id,
        },
        pageTransactions: txOnly,
    };
}

function isSame(remote: TransactionRead, scraped: TransactionSplitStore) {
    let tx = remote.attributes.transactions[0];
    if (tx.description !== scraped.description) {
        return false;
    }
    if (tx.type !== scraped.type) {
        return false;
    }
    if (parseFloat(tx.amount) !== parseFloat(scraped.amount)) {
        return false;
    }
    let remoteDate = Date.parse(tx.date as any as string);
    let scrapedDate = Date.parse(scraped.date as any as string);
    if (remoteDate !== scrapedDate) {
        if (allowFuzzyDates) {
            return Math.abs(remoteDate - scrapedDate) < 24 * 60 * 60 * 1000;
        }
        return false;
    }
    return true;
}

async function doScan(getLocalTxs = (acct: AccountRead) => scrapeTransactionsFromPage(acct).txs): Promise<void> {
    const accounts = await chrome.runtime.sendMessage({
        action: "list_accounts",
    });
    const acct = await getCurrentPageAccount(accounts);
    const txs = getLocalTxs(acct);
    pageAlreadyScraped = true;
    let endDate = txs[0].tx.transactions[0].date;
    const getRemoteTxs = async (ed: Date) => {
        return await chrome.runtime.sendMessage({
            action: "list_transactions",
            value: {accountId: acct.id, endDate: ed, pageSize: transactionsPerPage},
        });
    };
    let remoteTxs: TransactionRead[] = await getRemoteTxs(endDate);
    if (txs.length > 9 * remoteTxs.length) {
        // TODO: Show a warning that older transactions might get mis-flagged
    }
    for (let i = 0; i < 10; i++) {
        if (remoteTxs.length < txs.length) {
            const newEndDate = remoteTxs[remoteTxs.length-1].attributes.transactions[0].date;
            if (newEndDate == endDate) {
                newEndDate.setDate(newEndDate.getDate() - 1);
            }
            console.log(`Need more remotes ${txs.length} local vs ${remoteTxs.length} remote [Using endDate ${newEndDate}]`)
            let newRemotes = await getRemoteTxs(newEndDate);
            remoteTxs = [...remoteTxs, ...newRemotes];
        }
    }
    const adder = new FireflyTransactionUIAdder(
        acct.id, acct.attributes.accountRole == AccountRoleProperty.CcAsset,
    );
    for (let i = 0; i < txs.length; i++) {
        const v = txs[i];
        const scraped = v.tx.transactions[0];
        let metaTx = {
            tx: scraped,
            txRow: v.row as HTMLElement,
            prevRow: txs[i - 1]?.row as HTMLElement,
            nextRow: txs[i + 1]?.row as HTMLElement,
        } as MetaTx;
        let remoteMatches = remoteTxs.filter(remote => isSame(remote, scraped));
        if (remoteMatches.length > 1) {
            adder.registerDuplicates(metaTx, remoteMatches.slice(1));
        }
        if (remoteMatches.length >= 1) {
            adder.registerSynced(metaTx);
            remoteTxs = remoteTxs.filter(v => !remoteMatches.includes(v));
        } else {
            adder.registerLocalOnly(metaTx)
        }
    }
    remoteTxs
        .filter(v => new Date(v.attributes.transactions[0].date) > txs[txs.length - 1].tx.transactions[0].date)
        .map(v => {
            // TODO: Also factor in similarity of description (for the case where there are multiple Txs with the same date)
            let prevRow = Array.from(txs).reverse().find(x => new Date(x.tx.transactions[0].date) >= new Date(v.attributes.transactions[0].date));
            return ({
                tx: {...v.attributes.transactions[0], remoteId: v.id}, // BASE: add all sub transactions to remoteOnly
                prevRow: prevRow ? prevRow?.row as HTMLElement : undefined,
                nextRow: prevRow ? undefined : txs[0].row as HTMLElement,
            } as MetaTx);
        }).forEach(v => adder.registerRemoteOnly(v));
    adder.processAll();
}

async function doQueue(): Promise<void> {
    const accounts = await chrome.runtime.sendMessage({
        action: "list_accounts",
    });
    const acct = await getCurrentPageAccount(accounts);
    const txs = scrapeTransactionsFromPage(acct);
    queuedTxs[txs.pageNum] = txs.txs.map(t => ({...t, status: 'unknown'}))

    let htmlDivElement = document.createElement('div');
    htmlDivElement.style.position = 'fixed';
    htmlDivElement.style.left = '10px';
    htmlDivElement.style.width = '400px';
    htmlDivElement.style.top = '10px';
    htmlDivElement.style.bottom = '100px';
    htmlDivElement.style.background = 'white';
    htmlDivElement.style.overflowY = 'scroll';
    htmlDivElement.style.zIndex = '9999999';
    let id = 'firefly-scan-queue';
    htmlDivElement.id = id;

    const btn = document.createElement('button');
    btn.innerText = "Scan";
    btn.addEventListener("click", async () => doScan(
        acct => Object.values(queuedTxs).flatMap(v => v)
    ), false);

    htmlDivElement.append(btn);

    document.getElementById(id)?.remove();
    document.body.appendChild(htmlDivElement);

    Object.entries(queuedTxs).forEach(([k, v]) => {

        v.forEach(x => {
            x.tx.transactions.forEach(t => {
                const z = document.createElement('div');
                z.style.display = 'flex';
                z.style.background = x.status == 'both' ? 'green' : x.status == 'remote' ? 'orange' : '';
                const z1 = document.createElement('div');
                z1.innerText = t.description;
                z1.style.flexGrow = '1';
                const z2 = document.createElement('div');
                z2.innerText = t.amount;
                z2.style.flexGrow = '0';
                z.append(z1, z2);
                htmlDivElement.appendChild(z)
                x.row = z;
            })

        })
    })
}

const buttonId = 'firefly-iii-export-transactions-button';

function addButton() {
    const button = document.createElement("button");
    button.id = buttonId;
    button.textContent = "Export Transactions"
    button.addEventListener("click", async () => doScrape(false), false);
    // TODO: Try to steal styling from the page to make this look good :)
    button.classList.add("some", "classes", "from", "the", "page");
    getButtonDestination().append(button);

    const button2 = document.createElement("button");
    button2.id = buttonId + "2";
    button2.textContent = "Scan Transactions"
    button2.addEventListener("click", async () => doScan(), false);
    // TODO: Try to steal styling from the page to make this look good :)
    button2.classList.add("some", "classes", "from", "the", "page");
    getButtonDestination().append(button2);

    const button3 = document.createElement("button");
    button3.id = buttonId + "3";
    button3.textContent = "Queue for scan"
    button3.addEventListener("click", async () => doQueue(), false);
    // TODO: Try to steal styling from the page to make this look good :)
    button3.classList.add("some", "classes", "from", "the", "page");
    getButtonDestination().append(button3);
}

function enableAutoRun() {
    if (!isPageReadyForScraping()) {
        debugLog("Page is not ready for scraping")
        return;
    }
    chrome.runtime.sendMessage({
        action: "get_auto_run_state",
    }).then(state => {
        debugLog("Got state", state)
        if (state === AutoRunState.Transactions) {
            doScrape(true)
                .then((id: TransactionScrape) => {
                    if (isSingleAccountBank) {
                        return chrome.runtime.sendMessage({
                            action: "complete_auto_run_state",
                            state: AutoRunState.Transactions,
                        })
                    } else {
                        return chrome.runtime.sendMessage({
                            action: "increment_auto_run_tx_account",
                            lastAccountNameCompleted: id.pageAccount.name,
                        }).then(() => backToAccountsPage())
                    }
                });
        }
    });
}

[
    'account/account-summary',
    'account/search-transaction'
].forEach(txPage => {

    runOnURLMatch(txPage, () => pageAlreadyScraped = false);

// If your manifest.json allows your content script to run on multiple pages,
// you can call this function more than once, or set the urlPath to "".
    runOnContentChange(
        txPage,
        () => {
            if (!!document.getElementById(buttonId)) {
                return;
            }
            addButton();
        },
        getButtonDestination,
    )


    runOnContentChange(
        txPage,
        enableAutoRun,
        () => document.querySelector('#Transactions')!,
        'txAutoRun',
    );
});
