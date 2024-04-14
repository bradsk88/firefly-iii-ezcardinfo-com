import {AccountRead} from "firefly-iii-typescript-sdk-fetch/dist/models/AccountRead";
import {parseDate} from "../../common/dates";
import {priceFromString} from "../../common/prices";
import {getAccountElements, getAccountNumber} from "./accounts";

export function getButtonDestination(): Element {
    return document.querySelector('.nav-menu')!;
}

/**
 * @param accounts The first page of account in your Firefly III instance
 */
export async function getCurrentPageAccount(
    accounts: AccountRead[],
): Promise<AccountRead> {
    const accountNumber = getAccountNumber(getAccountElements()[0]);
    return accounts.find(
        acct => acct.attributes.accountNumber === accountNumber,
    )!;
}

export function isPageReadyForScraping(): boolean {
    return true;
}

export function getRowElements(): Element[] {
    return Array.from(document.querySelectorAll(
        '#Transactions #collapseTwo article'
    ).values());
}

export function getRowDate(el: Element): Date {
    return parseDate(el.children[0].children[0].children[0].textContent!);
}

export function getPageNum() {
return Number.parseInt(document.querySelector('.pagination li.active')!.textContent!);
}

function isRowLoading(r: Element): boolean {
    return false;
}

export function getRowAmount(r: Element, pageAccount: AccountRead): number {
    if (isRowLoading(r)) {
        throw new Error("Page is not ready for scraping")
    }
    const amountDiv = r.children[0].children[1].children[0].textContent!;
    return -priceFromString(amountDiv);
}

export function getRowDesc(r: Element): string {
    return r.children[0].children[0].children[1].textContent!;
}

export function findBackToAccountsPageButton(): HTMLElement {
    return undefined!;
}