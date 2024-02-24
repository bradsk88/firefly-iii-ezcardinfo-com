import {OpeningBalance} from "../../background/firefly_export";

export function getButtonDestination(): Element {
    return document.querySelector('.nav-menu')!;
}

export function isPageReadyForScraping(): boolean {
    return true;
}

export function getAccountElements(): Element[] {
    return [document.querySelector(
        '.header-main .text-right .dropdown .text-bold',
    )!];
}

export function shouldSkipScrape(accountElement: Element): boolean {
    return false
}

export function getAccountNumber(
    accountElement: Element,
): string {
    return accountElement.textContent!.split('-')[1].trim();
}

export function getAccountName(
    accountElement: Element,
): string {
    return getAccountNumber(accountElement)
}

export function getOpeningBalance(
    accountElement: Element,
): OpeningBalance | undefined {
    return undefined;
}