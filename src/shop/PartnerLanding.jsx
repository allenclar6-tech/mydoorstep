import { useState } from 'react'
import { ArrowRight, Check, ChevronRight } from 'lucide-react'
import { Band, TabBar } from './ShopKit'
import { Basket, Burger, MapPinArt, MoneyBag, Parcel, PercentTag, Pharmacy, PhoneOrders, Scooter, ShoppingBag, Storefront } from './Illustrations'
import { navigate } from './shopData'

// Landing pages for businesses and riders, in the same golden DOORSTEP style as the customer app.
// Every promise here describes something the platform really does today.

const link = (href) => (event) => { event.preventDefault(); navigate(href) }

function Hero({ art: Art, kicker, title, body, action, href, secondary, secondaryHref }) {
  return <section className="pl-hero">
    <div className="pl-hero-copy">
      <small>{kicker}</small>
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="pl-hero-actions">
        <a className="sp-primary" href={href} onClick={href.startsWith('#') ? (event) => { event.preventDefault(); document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' }) } : link(href)}>{action}<ArrowRight size={17} aria-hidden="true" /></a>
        {secondary && <a className="pl-hero-link" href={secondaryHref} onClick={link(secondaryHref)}>{secondary}</a>}
      </div>
    </div>
    <span className="pl-hero-art" aria-hidden="true"><Art /></span>
  </section>
}

function Benefits({ items }) {
  return <ul className="pl-benefits">{items.map(([Art, title, body, tone]) => <li key={title}>
    <span className={`pl-benefit-art sp-bubble-art is-${tone}`} aria-hidden="true"><Art /></span>
    <span><b>{title}</b><small>{body}</small></span>
  </li>)}</ul>
}

function Steps({ items }) {
  return <ol className="pl-steps">{items.map(([title, body], index) => <li key={title}><span className="pl-step-n" aria-hidden="true">{index + 1}</span><span><b>{title}</b><small>{body}</small></span></li>)}</ol>
}

function Faq({ items }) {
  const [open, setOpen] = useState(-1)
  return <ul className="sp-faq-list">{items.map(([question, answer], index) => <li key={question}><button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? -1 : index)}><b>{question}</b><ChevronRight size={16} aria-hidden="true" /></button>{open === index && <p>{answer}</p>}</li>)}</ul>
}

const BUSINESS_TYPES = [
  [Burger, 'Restaurant & food', 'Kitchens, bukas, cafés, bakeries and takeaways', '/partner/register/restaurant', 'sun'],
  [Basket, 'Grocery & supermarket', 'Supermarkets, mini marts and fresh produce', '/partner/register/store', 'mint'],
  [ShoppingBag, 'Shop', 'Phones, electronics, fashion and gifts', '/partner/register/store', 'sky'],
  [Pharmacy, 'Pharmacy & beauty', 'Pharmacies, cosmetics and personal care', '/partner/register/store', 'rose'],
]

export function BusinessLanding() {
  return <div className="sp-screen pl-page">
    <Band back="/" title="Partner with DOORSTEP" />
    <main className="sp-body">
      <Hero art={Storefront} kicker="FOR BUSINESSES IN DELTA, EDO & RIVERS" title="More orders. Less hassle." body="Put your restaurant, shop or pharmacy in front of customers across Delta, Edo and Rivers. Orders land on your phone, riders collect them, and your money goes to your bank." action="Apply now" href="#types" secondary="Already a partner? Sign in" secondaryHref="/partner/login" />

      <section className="sp-section">
        <h2 className="pl-h2">Why businesses join</h2>
        <Benefits items={[
          [PhoneOrders, 'Orders straight to your phone', 'A live order board with loud alerts. Accept, prepare and mark ready in one tap.', 'sun'],
          [Scooter, 'Delivery handled', 'DOORSTEP riders collect and deliver — or use your own riders if you prefer.', 'mint'],
          [MoneyBag, 'Paid to your bank', 'See every order’s earnings and withdraw from your dashboard.', 'mint'],
          [Storefront, 'Pickup orders too', 'Customers can collect at your counter. No rider, no delivery fee for them.', 'sand'],
          [PercentTag, 'Promotions on us', 'Free-delivery and promo-code offers are paid by DOORSTEP. You get your full share.', 'sun'],
          [MapPinArt, 'Found by customers near you', 'Show up in Food, Groceries, Shops or Pharmacy & Beauty — with photos, ratings and your menu.', 'rose'],
        ]} />
      </section>

      <section className="sp-section" id="types">
        <h2 className="pl-h2">What kind of business are you?</h2>
        <div className="pl-types">{BUSINESS_TYPES.map(([Art, title, body, href, tone]) => <a key={title} className="pl-type" href={href} onClick={link(href)}>
          <span className={`sp-bubble-art is-${tone}`} aria-hidden="true"><Art /></span>
          <span><b>{title}</b><small>{body}</small></span>
          <ChevronRight size={18} aria-hidden="true" />
        </a>)}</div>
      </section>

      <section className="sp-section">
        <h2 className="pl-h2">How it works</h2>
        <Steps items={[
          ['Apply in a few minutes', 'Tell us about your business, your opening hours and how you want orders delivered.'],
          ['We check and approve', 'DOORSTEP reviews every business before it goes live, so customers can trust what they order.'],
          ['Add your menu and go live', 'Upload photos and prices, switch on, and start receiving orders.'],
        ]} />
      </section>

      <section className="sp-section">
        <h2 className="pl-h2">Questions businesses ask</h2>
        <Faq items={[
          ['What does DOORSTEP charge?', 'A commission on item sales only — never on delivery fees you keep with your own riders. Each order in Earnings shows exactly what was applied.'],
          ['When do I get my money?', 'Your share of an order clears once it is delivered and the short hold period ends. Then you withdraw it to your bank from your dashboard.'],
          ['Can I use my own riders?', 'Yes. Choose DOORSTEP riders, your own riders, or both when you apply. With your own riders, you keep the delivery fee.'],
          ['Do I need a registered business?', 'No. Registered and unregistered businesses can apply; registered ones can also upload their certificate so DOORSTEP can verify it.'],
          ['Can I pause orders?', 'Yes. You can close temporarily, set your hours, and turn customer pickup on or off at any time.'],
        ]} />
      </section>

      <a className="pl-cta" href="#types" onClick={(event) => { event.preventDefault(); document.getElementById('types')?.scrollIntoView({ behavior: 'smooth' }) }}><span><b>Ready to grow?</b><small>Applying is free and takes about 10 minutes.</small></span><span className="sp-primary">Apply now</span></a>
    </main>
    <TabBar active="profile" />
  </div>
}

export function RiderLanding() {
  return <div className="sp-screen pl-page">
    <Band back="/" title="Ride with DOORSTEP" />
    <main className="sp-body">
      <Hero art={Scooter} kicker="FOR RIDERS IN DELTA, EDO & RIVERS" title="Ride when you want. Earn every trip." body="Deliver food, groceries and packages around your town. Go online when it suits you and see what you’ll earn before you accept." action="Become a rider" href="/rider/register" secondary="Already a rider? Sign in" secondaryHref="/rider/login" />

      <section className="sp-section">
        <h2 className="pl-h2">Why riders choose DOORSTEP</h2>
        <Benefits items={[
          [MoneyBag, 'See your pay first', 'Every delivery offer shows what you’ll earn before you accept it.', 'mint'],
          [Scooter, 'Your hours, your choice', 'Go online and offline whenever you like. No fixed shifts.', 'sun'],
          [HeartTip, '100% of tips are yours', 'Customers can tip at checkout, and every naira goes to you.', 'rose'],
          [PhoneOrders, 'Clear jobs, loud alerts', 'Strong vibration and sound for new jobs, plus pickup and drop-off on the map.', 'sky'],
          [Parcel, 'Food and packages', 'Restaurant orders, grocery runs and door-to-door packages across your town.', 'sand'],
          [MapPinArt, 'Withdraw to your bank', 'Track your earnings and withdraw from your rider dashboard.', 'mint'],
        ]} />
      </section>

      <section className="sp-section">
        <h2 className="pl-h2">What you need</h2>
        <ul className="pl-checks">{['A bicycle, motorcycle or car you own or may use', 'A valid ID', 'A smartphone with data', 'An emergency contact', 'A bank account in your name'].map((item) => <li key={item}><Check size={16} aria-hidden="true" />{item}</li>)}</ul>
      </section>

      <section className="sp-section">
        <h2 className="pl-h2">How to start</h2>
        <Steps items={[
          ['Apply online', 'Your details, vehicle and an emergency contact. It takes a few minutes.'],
          ['Get verified', 'DOORSTEP checks your identity and vehicle before you can ride.'],
          ['Go online and earn', 'Accept jobs near you, deliver, and withdraw your earnings.'],
        ]} />
      </section>

      <section className="sp-section">
        <h2 className="pl-h2">Questions riders ask</h2>
        <Faq items={[
          ['How much will I earn?', 'Pay depends on the trip distance and is shown on every offer before you accept. Tips are extra and 100% yours.'],
          ['Can I decline a job?', 'Yes. If you don’t accept, the job moves to the next rider nearby.'],
          ['How do I get paid?', 'Your earnings build up in your rider dashboard. Add your bank account and withdraw from there.'],
          ['Is there a fee to join?', 'No. Applying to ride with DOORSTEP is free.'],
        ]} />
      </section>

      <a className="pl-cta" href="/rider/register" onClick={link('/rider/register')}><span><b>Start riding</b><small>Apply free in a few minutes.</small></span><span className="sp-primary">Become a rider</span></a>
    </main>
    <TabBar active="profile" />
  </div>
}

function HeartTip() {
  return <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
    <defs><linearGradient id="pl-heart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff7a9a" /><stop offset="1" stopColor="#d6335c" /></linearGradient></defs>
    <ellipse cx="32" cy="57" rx="18" ry="3.2" fill="#0c261d" opacity=".14" />
    <path d="M32 52S10 39 10 24c0-7 5-12 11-12 5 0 9 3 11 7 2-4 6-7 11-7 6 0 11 5 11 12 0 15-22 28-22 28z" fill="url(#pl-heart)" />
    <path d="M16 22c1-4 4-6 7-6-3 2-4 4-5 7z" fill="#fff" opacity=".5" />
    <text x="32" y="38" textAnchor="middle" fontSize="15" fontWeight="900" fill="#fff" fontFamily="Manrope, sans-serif">₦</text>
  </svg>
}
