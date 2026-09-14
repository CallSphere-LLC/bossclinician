import {api} from "@/lib/api";
import {checkoutButtonStyle} from "@/components/checkout/checkoutStyle";
import {useEffect,useState} from "react";
import {Link} from "react-router-dom";
import {Seo} from "@/components/Seo";
import {Section} from "@/components/luxe/Section";
import {GlassCard} from "@/components/luxe/GlassCard";
import {CheckoutExperience} from "./Checkout";
import {commerceApi,type PublicOffer,type OfferQuote} from "@/lib/commerceApi";
import {memberRequest} from "@/lib/memberApi";
import {readCart,writeCart,type CartSelection} from "@/lib/cart";
import {formatCurrency} from "@/lib/format";

type CatalogOffer={slug:string;title:string;description:string;thumbnailUrl:string;amountCents:number;currency:string};
export default function Cart(){
  const [checkoutSettings,setCheckoutSettings]=useState<Record<string,unknown>>({});
  useEffect(()=>{api.settings().then(settings=>setCheckoutSettings((settings.checkout??{}) as Record<string,unknown>)).catch(()=>{});},[]);
  const [items,setItems]=useState<CartSelection[]>([]);
  useEffect(()=>{
    const refresh=()=>setItems(readCart());
    refresh();window.addEventListener('storage',refresh);window.addEventListener('bossclinician-cart',refresh);
    return()=>{window.removeEventListener('storage',refresh);window.removeEventListener('bossclinician-cart',refresh);};
  },[]);
  const [offers,setOffers]=useState<PublicOffer[]>([]);
  const [catalog,setCatalog]=useState<CatalogOffer[]>([]);
  const [quote,setQuote]=useState<OfferQuote|null>(null);
  const [code,setCode]=useState("");
  const [error,setError]=useState("");
  const [pending,setPending]=useState(false);
  const [checkout,setCheckout]=useState(false);
  const key=JSON.stringify(items);
  useEffect(()=>{memberRequest<{offers:CatalogOffer[]}>("/cart/catalog").then(r=>setCatalog(r.offers)).catch(()=>{});},[]);
  useEffect(()=>{
    let cancelled=false;setError("");setQuote(null);setOffers([]);
    if(!items.length){setPending(false);return;}
    setPending(true);
    Promise.all([Promise.all(items.map(item=>commerceApi.getOffer(item.slug))),commerceApi.quote(items[0].slug,{cartItems:items})])
      .then(([loaded,total])=>{if(!cancelled){setOffers(loaded);setQuote(total);}})
      .catch(err=>{if(!cancelled)setError(err instanceof Error?err.message:"Could not load your cart.");})
      .finally(()=>{if(!cancelled)setPending(false);});
    return()=>{cancelled=true;};
  },[key]);
  function update(next:CartSelection[]){writeCart(next);setItems(next);setCode("");setCheckout(false);}
  async function apply(){if(!items.length)return;setPending(true);setError("");try{setQuote(await commerceApi.quote(items[0].slug,{cartItems:items,couponCode:code}));}catch(err){setError(err instanceof Error?err.message:"This code could not be applied.");}finally{setPending(false);}}
  const first=offers[0];
  let combined:PublicOffer|null=null;
  if(first&&quote&&offers.length===items.length){
    const selected=first.pricingOptions.find(p=>p.id===(items[0].pricingOptionId??null))??first.pricingOptions[0];
    combined={...first,title:`Your cart (${items.length} items)`,description:"One payment. Everything you chose, ready in your library.",checkoutHeadline:"Complete your order",cartItems:items,initialCouponCode:quote.coupon?.code??"",
      cartTerms:offers.filter(o=>o.orderForm.requireTerms).map(o=>({title:o.title,url:o.orderForm.termsUrl})),
      amountCents:quote.subtotalCents,quote,selectedPricingOptionId:selected.id,pricingOptions:[{...selected,amountCents:quote.subtotalCents,quote}],
      orderForm:{...first.orderForm,allowGifting:offers.every(o=>o.orderForm.allowGifting),collectPhone:offers.some(o=>o.orderForm.collectPhone),collectAddress:offers.some(o=>o.orderForm.collectAddress),collectTax:offers.some(o=>o.orderForm.collectTax),requireTerms:offers.some(o=>o.orderForm.requireTerms),termsUrl:"/terms",customFields:offers.flatMap(o=>o.orderForm.customFields.map(f=>({...f,key:`${o.id}:${f.key}`,label:`${o.title}: ${f.label}`})))},
      products:offers.flatMap(o=>o.products),bumps:[],upsells:first.upsells.filter(u=>!items.some(i=>i.slug===u.offer.slug)),redirectUrl:"",alreadyOwned:offers.every(o=>o.alreadyOwned)};
  }
  return <><Seo title="Your cart - Boss Clinician"/><Section surface="deep" space="md">
    <div className="mx-auto max-w-6xl px-4 text-white">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4"><h1 className="font-display text-3xl">Your cart</h1><Link to="/courses" className="text-gold underline">Continue browsing</Link></div>
      {checkout&&combined?<CheckoutExperience offer={combined}/>:<>
        {error&&<p role="alert" className="mb-5 rounded-xl border border-red-400 p-4 text-red-200">{error}</p>}
        {pending&&<p role="status" className="mb-4">Updating your cart…</p>}
        {!items.length?<p className="mb-8 text-orchid">Your cart is empty. Choose an offer below to get started.</p>:<GlassCard accent="plum" interactive={false} className="mb-8 p-5 sm:p-8">
          <ul className="divide-y divide-white/10">{items.map((item,index)=>{const offer=offers.find(o=>o.slug===item.slug);return <li key={item.slug} className="py-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><Link to={`/checkout/${item.slug}`} className="font-semibold text-white">{offer?.title??item.slug}</Link><p className="mt-1 text-sm text-orchid">{quote?.lines.find(l=>l.offerId===offer?.id&&l.kind==='offer') ? formatCurrency(quote.lines.find(l=>l.offerId===offer?.id&&l.kind==='offer')!.amountCents,quote.currency):""}</p></div>
              <button type="button" className="text-sm text-gold underline" onClick={()=>update(items.filter((_,i)=>i!==index))}>Remove<span className="sr-only"> {offer?.title??item.slug}</span></button></div>
            {offer?.bumps.map(bump=><label key={bump.id} className="mt-3 flex items-center gap-3 text-sm text-orchid"><input type="checkbox" checked={(item.bumpProductIds??[]).includes(bump.productId)} onChange={e=>update(items.map((current,i)=>i===index?{...current,bumpProductIds:e.target.checked?[...(current.bumpProductIds??[]),bump.productId]:(current.bumpProductIds??[]).filter(id=>id!==bump.productId)}:current))}/>{bump.title} — {bump.formattedAmount}</label>)}
          </li>})}</ul>
          {checkoutSettings.showCoupons!==false&&<div className="mt-5 flex flex-wrap gap-3"><label className="min-w-0 flex-1 text-sm text-orchid">Discount code<input aria-label="Discount code" value={code} onChange={e=>setCode(e.target.value)} className="mt-2 block w-full rounded-lg border border-white/20 bg-white/5 p-3 text-white"/></label><button type="button" onClick={()=>void apply()} disabled={pending} className="self-end rounded-lg border border-gold px-5 py-3 text-gold">Apply</button></div>}
          {quote&&<dl className="mt-6 space-y-3"><div className="flex justify-between"><dt>Subtotal</dt><dd>{quote.formatted.subtotal}</dd></div>{quote.discountCents>0&&<div className="flex justify-between text-gold"><dt>Discount ({quote.coupon?.code})</dt><dd>−{quote.formatted.discount}</dd></div>}{quote.taxCents>0&&<div className="flex justify-between"><dt>Tax</dt><dd>{quote.formatted.tax}</dd></div>}<div className="flex justify-between border-t border-white/10 pt-4 text-xl font-semibold"><dt>Order total</dt><dd>{quote.formatted.total}</dd></div></dl>}
          <button type="button" disabled={!combined||pending||!!error} onClick={()=>setCheckout(true)} style={checkoutButtonStyle(checkoutSettings)} className="mt-6 w-full rounded-xl bg-gold px-5 py-4 font-semibold text-night-deep disabled:opacity-40">Continue to checkout</button>
        </GlassCard>}
        <h2 className="mb-4 font-display text-2xl">Browse offers</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{catalog.filter(o=>!items.some(i=>i.slug===o.slug)).map(offer=><GlassCard key={offer.slug} accent="plum" interactive={false} className="flex flex-col p-5"><h3 className="text-lg font-semibold">{offer.title}</h3><p className="mt-3 text-gold">{formatCurrency(offer.amountCents,offer.currency)}</p><button type="button" disabled={items.length>=20} onClick={()=>update([...items,{slug:offer.slug,pricingOptionId:null}])} className="mt-5 rounded-lg border border-gold p-3 text-gold">Add to cart</button></GlassCard>)}</div>
      </>}
    </div>
  </Section></>;
}
