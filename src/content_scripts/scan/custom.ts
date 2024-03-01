export function applyStylingToFoundRow(
    row: HTMLElement, defaultBgCss: string,
): void {
    // This updates the row element to indicate that the data was successfully
    // found on both the local page and the remote server.
    // TODO: Update the styles/layout if necessary
    row.style.background = defaultBgCss;
}

export function applyStylingAndAddButtonForLocalOnlyRow(
    row: HTMLElement, syncToRemote: (e: MouseEvent) => void,
): void {
    // This updates the row element to indicate that the data was only found on
    // the local page and is missing from the remote server. It also adds a
    // button to sync the data to the remote server.
    // TODO: Update the styles/layout if necessary
    let node = document.createElement("button");
    node.innerText = 'Sync to Firefly III';
    node.addEventListener('click', syncToRemote);
    node.classList.add("added-by-firefly-iii-scan");
    row.appendChild(node);
}

export function buildRowForRemoteOnlyTx(defaultBgCss: string, tx: {
    date: Date;
    description: string;
    amount: string
}, btnFn: (removeElementOnSuccess: HTMLElement) => HTMLButtonElement): HTMLElement {
    const el = document.createElement("article");
    el.style.background = defaultBgCss;
    const outer = document.createElement('div');
    outer.classList.add('grid', 'list-item');
    const inner = document.createElement('div');
    inner.classList.add('col-c-60');
    const date = document.createElement('div');
    date.classList.add('text-muted', 'text-uppercase');
    date.textContent = `${tx.date} (Found on server but not on bank site)`;
    const desc = document.createElement('span');
    desc.classList.add('text-highlight', 'text-bold');
    desc.textContent = `${tx.description}`;
    inner.append(date, desc);
    outer.append(inner);

    const inner2 = document.createElement('div');
    inner2.classList.add('col-c-40', 'text-right', 'truncate');

    const amount = document.createElement('div');
    amount.classList.add('text-bold');
    amount.innerText = `$${parseFloat(tx.amount).toFixed(2)}`;
    inner2.append(amount);

    inner2.append(btnFn(el));

    outer.append(inner2);

    el.append(outer);
    return el;
}
