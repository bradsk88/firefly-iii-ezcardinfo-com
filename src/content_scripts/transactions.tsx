import {TransactionSplitStore, TransactionStore, TransactionTypeProperty} from "firefly-iii-typescript-sdk-fetch";
import {AutoRunState} from "../background/auto_state";
import {
    getButtonDestination,
    getCurrentPageAccount,
    getRowAmount,
    getRowDate,
    getRowDesc,
    getRowElements,
    isPageReadyForScraping
} from "./scrape/transactions";
import {PageAccount} from "../common/accounts";
import {runOnURLMatch} from "../common/buttons";
import {runOnContentChange} from "../common/autorun";
import {AccountRead} from "firefly-iii-typescript-sdk-fetch/dist/models/AccountRead";
import {debugAutoRun, isSingleAccountBank} from "../extensionid";
import {backToAccountsPage} from "./auto_run/transactions";
import {debugLog, showDebug} from "./auto_run/debug";
import {TransactionSplit} from "firefly-iii-typescript-sdk-fetch/dist/models/TransactionSplit";

// TODO: You will need to update manifest.json so this file will be loaded on
//  the correct URL.

interface TransactionScrape {
    pageAccount: PageAccount;
    pageTransactions: TransactionStore[];
}

let pageAlreadyScraped = false;

export interface TSWP {
    tx: TransactionStore,
    row: Element,
}

/**
 * @param pageAccount The Firefly III account for the current page
 */
export function scrapeTransactionsFromPage(
    pageAccount: AccountRead,
): TSWP[] {
    const rows = getRowElements();
    return rows.map((r, idx) => {
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
    });
}

async function doScrape(isAutoRun: boolean): Promise<TransactionScrape> {
    if (isAutoRun && pageAlreadyScraped) {
        throw new Error("Already scraped. Stopping.");
    }

    const accounts = await chrome.runtime.sendMessage({
        action: "list_accounts",
    });
    const acct = await getCurrentPageAccount(accounts);
    const txs = scrapeTransactionsFromPage(acct);
    pageAlreadyScraped = true;
    if (!debugAutoRun) {
        await chrome.runtime.sendMessage({
                action: "store_transactions",
                is_auto_run: isAutoRun,
                value: txs,
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
        pageTransactions: txs.map(v => v.tx),
    };
}

function isSame(remote: TransactionSplit, scraped: TransactionSplitStore) {
    if (parseFloat(remote.amount) !== parseFloat(scraped.amount)) {
        return false;
    }
    if (Date.parse(remote.date as any as string) !== Date.parse(scraped.date as any as string)) {
        return false;
    }
    if (remote.description !== scraped.description) {
        return false;
    }
    return true;
}

async function doScan(): Promise<void> {
    const accounts = await chrome.runtime.sendMessage({
        action: "list_accounts",
    });
    const acct = await getCurrentPageAccount(accounts);
    const txs = scrapeTransactionsFromPage(acct);
    pageAlreadyScraped = true;
    const remoteTxs: TransactionSplit[] = await chrome.runtime.sendMessage({
        action: "list_transactions",
        value: acct.id,
    });
    txs.forEach(v => {
        const scraped = v.tx.transactions[0];
        if (remoteTxs.find(remote => isSame(remote, scraped))) {
            (v.row as HTMLElement).style.background = 'rgba(230, 230, 255, 255)';
        }
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

const txPage = 'account/account-summary';

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
