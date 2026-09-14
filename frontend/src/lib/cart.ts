export interface CartSelection {slug:string;pricingOptionId?:number|null;bumpProductIds?:number[];}
const KEY="bossclinician-cart-v1";
export function readCart():CartSelection[] {
  if(typeof window==='undefined')return [];
  try {const items=JSON.parse(localStorage.getItem(KEY)??"[]");return Array.isArray(items)?items.filter((i:any)=>typeof i?.slug==='string').slice(0,20):[];}catch{return [];}
}
export function writeCart(items:CartSelection[]):void {
  localStorage.setItem(KEY,JSON.stringify(items));window.dispatchEvent(new Event('bossclinician-cart'));
}
export function addToCart(item:CartSelection):void {
  const items=readCart();const index=items.findIndex(i=>i.slug===item.slug);
  if(index>=0)items[index]=item;else if(items.length<20)items.push(item);
  else throw new Error("Your cart can hold up to 20 offers.");
  writeCart(items);
}
