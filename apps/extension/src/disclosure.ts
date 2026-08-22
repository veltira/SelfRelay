export type DisclosureButton=Pick<HTMLButtonElement,'getAttribute'|'setAttribute'>;
export type DisclosurePanel=Pick<HTMLElement,'hidden'>;

export function setDisclosureState(button:DisclosureButton,panel:DisclosurePanel,open:boolean){
  panel.hidden=!open;
  button.setAttribute('aria-expanded',String(open));
}

export function toggleDisclosure(button:DisclosureButton,panel:DisclosurePanel){
  const open=button.getAttribute('aria-expanded')!=='true';
  setDisclosureState(button,panel,open);
  return open;
}
