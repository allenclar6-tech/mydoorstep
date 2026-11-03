// DOORSTEP Privacy Policy and Terms and Conditions (structure modelled on Glovo's). Written for Nigeria: the Nigeria
// Data Protection Act 2023 (NDPA), the Federal Competition and Consumer Protection Act 2018 (FCCPA) and Nigerian
// law generally. Every statement here must stay true to how the app works — update this file when features change.
//
// Each section: { id, heading, paragraphs: [...], list?: [...], after?: [...] }. Strings may use **bold**.

export const LEGAL_ENTITY = {
  name: 'DOORSTEP',
  // Registered company name and RC number: add them here once confirmed (Corporate Affairs Commission).
  registeredName: null,
  rcNumber: null,
  address: 'Sapele, Delta State, Nigeria',
  email: 'support@mydoorstep.com.co',
  website: 'https://mydoorstep.com.co',
}
export const LAST_UPDATED = '3 November 2026'

const who = LEGAL_ENTITY.registeredName ? `${LEGAL_ENTITY.registeredName}${LEGAL_ENTITY.rcNumber ? ` (RC ${LEGAL_ENTITY.rcNumber})` : ''}, trading as DOORSTEP` : 'DOORSTEP'

export const privacyPolicy = {
  title: 'Privacy Policy',
  intro: 'How DOORSTEP collects, uses and protects your personal data when you order, sell or deliver with us.',
  summary: [
    'We collect what we need to take, deliver and support your orders — and nothing for advertising.',
    'Card numbers and CVCs are entered on Paystack. DOORSTEP never sees or stores them.',
    'Riders share their location only while online or on a delivery. Customers share theirs only when they choose to.',
    'We share data only with the store, the rider and the service providers needed for your order, never to sell it.',
    'You can see, correct or delete your data, and complain to the Nigeria Data Protection Commission.',
  ],
  sections: [
    {
      id: 'who-we-are', heading: 'Who we are',
      paragraphs: [
        `This Privacy Policy explains how ${who} ("**DOORSTEP**", "**we**", "**us**") handles personal data on the DOORSTEP website (${LEGAL_ENTITY.website}), the DOORSTEP and DOORSTEP Admin apps, and our related services (together, the "**Platform**").`,
        `DOORSTEP is the data controller for the personal data described here, under the Nigeria Data Protection Act 2023 ("**NDPA**"). We are based in ${LEGAL_ENTITY.address}. You can contact us about anything in this policy at **${LEGAL_ENTITY.email}**.`,
        'The Platform connects four groups of people, and this policy covers all of them: **customers** who order, **partners** (restaurants, grocery stores, shops and pharmacies) who sell, **riders** who deliver, and **visitors** who browse.',
      ],
    },
    {
      id: 'data-we-collect', heading: 'The personal data we collect',
      paragraphs: ['What we collect depends on how you use DOORSTEP.'],
      list: [
        '**Account details (everyone):** your name, email address, phone number, password (stored only as a secure scrambled "hash"), profile photo if you add one, and how you signed in (email, phone code or Google).',
        '**Orders (customers):** the items you order, the store, prices, fees, tips, promo codes, whether you chose delivery or pickup, any scheduled time, notes to the store or rider, and the order’s progress.',
        '**Delivery addresses (customers):** the addresses you save or type, with the landmark and directions you add, and the map pin if you place one.',
        '**Location:** for **riders**, the device’s location while you are online or on a delivery, so we can offer nearby jobs, show customers where their order is and calculate distance-based pay. For **customers**, your location only when you tap to use it (for example to find your address). We do not track customers in the background.',
        '**Payments:** for card payments, Paystack gives us a reusable card "token", the card brand, the last 4 digits, the expiry month and year, the bank name and the name on the card. We keep the token encrypted. For bank transfers we keep the transfer reference and any receipt you upload. **We never receive or store full card numbers or CVCs.**',
        '**Partner details (businesses):** business name, address, opening hours, menu or product list, photos, the owner’s name, phone and email, WhatsApp number, business category, CAC registration number and certificate where given, and identity document details submitted for verification.',
        '**Rider details:** identity document details and images, vehicle type and details, documents submitted for approval, delivery history, ratings and earnings.',
        '**Payout details (partners and riders):** the bank name, the account name and the last 4 digits of the account number. The full account number is held by Paystack, which we use to send payouts; authorised DOORSTEP staff can read it from Paystack when paying you by hand, and each time they do so is recorded.',
        '**Reviews and ratings:** star ratings, thumbs-up or down on items, and written comments. Reviews are shown publicly with your **first name and the first letter of your surname only**.',
        '**Support:** messages you send through Help, chat, email or phone, and the details of any complaint, refund or account-deletion request.',
        '**Device and technical data:** your browser and device type, and the information our servers need to keep the Platform secure and working (such as IP address, error logs and sign-in records). If you turn on notifications, we store the notification address your browser gives us for that device.',
      ],
      after: ['We do not collect more than we need. We do not use advertising trackers, sell data, or build advertising profiles.'],
    },
    {
      id: 'how-we-use', heading: 'How we use your data, and why we are allowed to',
      paragraphs: ['The NDPA requires a lawful basis for each use. Ours are:'],
      list: [
        '**To provide the service you asked for (contract):** creating your account; taking, paying for, preparing, delivering and tracking orders and parcels; showing the store and the rider what they need to complete your order; paying partners and riders; calculating delivery fees, commission and rider pay; sending order updates; and handling cancellations and refunds.',
        '**To meet legal obligations:** keeping financial and tax records, responding to lawful requests from authorities, and verifying partners and riders where the law or payment rules require it.',
        '**For our legitimate interests (balanced against your rights):** keeping the Platform safe, preventing fraud and misuse (for example checking a business against the CAC registry and confirming bank account names), resolving disputes, improving our service using our own order statistics, and protecting our rights.',
        '**With your consent:** phone or computer notifications, using your device’s location as a customer, and any optional marketing messages. You can withdraw consent at any time in your browser or phone settings or in your account, without affecting anything done before.',
      ],
      after: ['We do not make decisions about you that have legal or similarly significant effects purely by automated means. Automatic steps such as offering a job to the nearest rider can always be reviewed by a person.'],
    },
    {
      id: 'sharing', heading: 'Who we share it with',
      paragraphs: ['We share personal data only where needed, and never sell it:'],
      list: [
        '**The store you order from:** your first name, the order, your phone number and, for delivery orders handled by its own rider, the delivery address — so it can prepare and hand over your order.',
        '**The rider delivering your order:** your first name, delivery address and directions, phone number and the order’s delivery code.',
        '**Customers:** a rider’s first name, vehicle and live position during the delivery, and a store’s public details.',
        '**Service providers** who process data for us under contract: **Paystack** (card and bank payments, saved cards, payouts and bank account checks); **Render** (our servers, database and private document storage); **Cloudflare** (delivering the website securely); **Mapbox** and **Google** (maps, address search, road distances and directions; Google sign-in if you choose it); **Resend** (emails); **Termii**, **Twilio** and **WhatsApp (Meta)** (sign-in codes by SMS or WhatsApp); a business-registry verification provider (CAC checks); and your browser’s notification service (Google, Apple, Microsoft or Mozilla) to deliver notifications.',
        '**Authorities and advisers:** police, courts, regulators or tax authorities when the law requires it, or to protect someone’s safety; and our lawyers, accountants and auditors.',
        '**A new owner:** if DOORSTEP is sold or merged, your data may pass to the new owner, who must respect this policy.',
      ],
    },
    {
      id: 'transfers', heading: 'Data stored or processed outside Nigeria',
      paragraphs: [
        'Some of our service providers (for example our hosting, email, maps and messaging providers) store or process data outside Nigeria, including in the United States and the European Union. When this happens we rely on the safeguards the NDPA allows — such as the provider’s contractual commitments to protect the data to a standard at least equal to Nigerian law — and we only transfer what the service needs.',
      ],
    },
    {
      id: 'retention', heading: 'How long we keep it',
      list: [
        '**Your account:** for as long as it is open. When you ask us to delete it, we delete or anonymise your personal data, except what we must keep for the reasons below.',
        '**Orders, payments, refunds and payouts:** for as long as tax, accounting and anti-fraud law requires — generally **six years** after the transaction.',
        '**Rider location history:** only as long as needed for the delivery, pay calculations and resolving any complaint about it.',
        '**Identity and verification documents:** while the partner or rider account is active, and afterwards only as long as needed to resolve disputes or meet legal duties.',
        '**Support conversations:** for as long as needed to resolve the issue and handle any follow-up.',
      ],
    },
    {
      id: 'security', heading: 'How we protect it',
      paragraphs: [
        'We use encryption in transit (HTTPS) everywhere; passwords are stored only as secure hashes; saved-card tokens are encrypted; identity documents, receipts and certificates are kept in private storage that only authorised staff can open; staff access is limited by role; and sensitive actions (such as viewing a payout account or changing payout details) are logged. Changing a payout bank account requires your password and notifies you.',
        'No system is perfectly secure. If a breach is likely to put your rights at risk, we will notify the Nigeria Data Protection Commission within 72 hours and tell you without undue delay where the law requires it.',
      ],
    },
    {
      id: 'rights', heading: 'Your rights',
      paragraphs: ['Under the NDPA you have the right to:'],
      list: [
        '**Access** the personal data we hold about you and get a copy.',
        '**Correct** data that is wrong or incomplete (most of it you can edit yourself in your account).',
        '**Delete** your data ("right to be forgotten"). Customers can ask from **Profile → Delete account**; anyone can email us.',
        '**Restrict** or **object to** how we use your data, including objecting to any marketing at any time.',
        '**Data portability:** receive data you gave us in a common format, or have it sent to another provider where technically possible.',
        '**Withdraw consent** where we rely on it, for example by turning off notifications or location permission.',
        '**Complain** to the **Nigeria Data Protection Commission (NDPC)** if you think we have mishandled your data. We would appreciate the chance to fix it first.',
      ],
      after: [`To use any of these rights, email **${LEGAL_ENTITY.email}** from the email address on your account, or use the Help section of the app. We may ask you to confirm who you are. We reply within 30 days.`],
    },
    {
      id: 'children', heading: 'Children',
      paragraphs: ['DOORSTEP accounts are for people aged **18 or over**. We do not knowingly collect data from children. If you believe a child has given us personal data, contact us and we will delete it.'],
    },
    {
      id: 'storage', heading: 'Cookies, device storage and notifications',
      paragraphs: [
        'DOORSTEP does not use advertising or third-party tracking cookies. We use your browser’s own storage only for things the app needs: keeping you signed in, remembering your chosen area and delivery location, and remembering choices such as whether you dismissed a prompt. Your answer to the cookie banner is remembered in one small cookie. DOORSTEP uses no optional cookies today, so choosing "Essential only" or "Accept cookies" changes nothing else; if we ever add optional cookies, they will only run if you accept them. Signing out removes your sign-in from that device.',
        'If you install the DOORSTEP app, a small "service worker" runs on your device to show notifications and an offline screen. It does not store your orders or personal data. You can turn notifications off at any time in your phone or browser settings.',
      ],
    },
    {
      id: 'links', heading: 'Other websites and services',
      paragraphs: ['When you pay, you use Paystack’s own secure page or pop-up, which is covered by Paystack’s privacy policy. Links to partners’ or other websites are covered by their own policies, not this one.'],
    },
    {
      id: 'changes', heading: 'Changes to this policy',
      paragraphs: ['We may update this policy as DOORSTEP changes or the law requires. We will show the new date at the top, and tell you in the app or by email before important changes take effect.'],
    },
    {
      id: 'contact', heading: 'Contact us',
      paragraphs: [`DOORSTEP — ${LEGAL_ENTITY.address}. Email: **${LEGAL_ENTITY.email}**. You can also reach us through Help in the app.`],
    },
  ],
}

export const termsAndConditions = {
  title: 'Terms and Conditions',
  intro: 'The rules for using DOORSTEP to order, sell or deliver in Delta, Edo and Rivers States. Please read them — by using DOORSTEP you agree to them.',
  summary: [
    'DOORSTEP is a platform: stores sell their own products, and riders deliver them. We take and pay for the order and coordinate it.',
    'The price you see at checkout, including delivery and service fees, is the price you pay.',
    'You can cancel free of charge until the store accepts your order. If a store declines it, you get your money back.',
    'Tips go 100% to the person who delivers your order.',
    'Nothing in these terms takes away your rights under Nigerian consumer protection law.',
  ],
  sections: [
    {
      id: 'about', heading: 'About these terms',
      paragraphs: [
        `These Terms and Conditions ("**Terms**") are an agreement between you and ${who} ("**DOORSTEP**", "**we**", "**us**"), based in ${LEGAL_ENTITY.address}. They apply to the DOORSTEP website (${LEGAL_ENTITY.website}), the DOORSTEP and DOORSTEP Admin apps and our related services (the "**Platform**").`,
        'By creating an account, placing an order, or registering as a partner or rider, you agree to these Terms and to our **Privacy Policy**. Partners and riders also agree to the **Restaurant partner terms** and **Rider terms**, which add to these Terms. If you do not agree, please do not use the Platform.',
      ],
    },
    {
      id: 'definitions', heading: 'Words we use',
      list: [
        '**Customer:** a person who orders products or a delivery through the Platform.',
        '**Partner:** a restaurant, grocery store, shop, pharmacy or other business that sells through the Platform.',
        '**Rider:** an independent delivery person approved to deliver through the Platform, or a partner’s own rider.',
        '**Order:** a request by a customer to buy products from a partner, delivered by a rider or collected by the customer.',
        '**Parcel delivery:** a request to carry an item from one place to another, without buying anything from a partner.',
      ],
    },
    {
      id: 'service', heading: 'What DOORSTEP does',
      paragraphs: [
        'DOORSTEP is a technology platform that connects customers, partners and riders in towns across Delta, Edo and Rivers States, Nigeria. **Partners sell their own products** and are responsible for them — their quality, safety, ingredients, allergens, labelling, freshness and legality. **Riders carry out deliveries** as independent service providers, not as DOORSTEP employees. DOORSTEP takes and processes the order and payment, coordinates the store and the rider, and provides customer support.',
        'We do our best to keep the Platform available and accurate, but stores open and close, menus change, and some areas or times may not be served. Delivery is only available in the areas shown in the app.',
      ],
    },
    {
      id: 'accounts', heading: 'Your account',
      list: [
        'You must be **18 or over** and able to enter a binding contract.',
        'Give accurate details and keep them up to date — especially your phone number and delivery address, which the rider relies on.',
        'Keep your password and sign-in codes private. You are responsible for what happens in your account unless it was used without your fault; tell us at once if you think someone else has used it.',
        'One person, one customer account. Accounts may not be sold or transferred.',
        'You can ask to close your account at any time (**Profile → Delete account**). See the Privacy Policy for what happens to your data.',
      ],
    },
    {
      id: 'ordering', heading: 'Placing an order',
      list: [
        '**Prices** are set by the partner and shown in naira, including VAT where it applies. Partners may change prices, and the price that counts is the one shown at checkout when you place the order.',
        '**Fees:** the checkout shows every fee before you pay — the **delivery fee** (based on the road distance, the area and busy times; none for pickup), the **service fee**, any **tip** you add, and any **promotion** applied. The total you confirm is the total you pay.',
        '**When the contract is made:** your order is a request to buy from the partner. It is confirmed when the partner accepts it. A partner may decline an order (for example when an item has sold out); if that happens you are refunded as described below.',
        '**Substitutions:** if an item is unavailable, the partner or DOORSTEP may contact you. Nothing is substituted at a higher price without your agreement.',
        '**Special requests and allergies:** add notes for the store, but partners cannot guarantee that food is free of any allergen. If you have a serious allergy, contact the store before ordering.',
        '**Restricted products:** some products (for example certain medicines) can only be sold in line with Nigerian law and the partner’s own checks, and may need a prescription or proof of age at handover. The partner or rider may refuse to hand them over if the conditions are not met.',
        '**Scheduled orders:** you can choose a time; we aim to deliver within the window shown but cannot guarantee an exact minute.',
      ],
    },
    {
      id: 'payment', heading: 'Payment',
      list: [
        'Payments are processed by **Paystack**. You can pay by card, by bank transfer to DOORSTEP’s account (confirmed by our team once the money arrives), or with a card you saved. Card details are entered on Paystack’s secure page; DOORSTEP never sees your card number or CVC.',
        '**Saving a card:** to check a new card, Paystack may make a small verification charge, which is refunded automatically.',
        '**Bank transfers:** your order is confirmed only after the exact amount reaches DOORSTEP’s account. If the money doesn’t arrive, or the amount doesn’t match, the order is closed and we help you get any money back.',
        '**Promotions and promo codes** are funded by DOORSTEP, have the conditions shown with them (such as minimum spend, first order only, one use per customer, or an end date), have no cash value, and can be withdrawn if misused.',
        'If a payment fails, you can try again from the order. We never charge you twice for the same order; if you think you were, contact us and we will put it right.',
      ],
    },
    {
      id: 'delivery', heading: 'Delivery and pickup',
      list: [
        '**Delivery times** shown are estimates. They depend on the store’s preparation time, traffic, weather and rider availability.',
        '**Be reachable:** please keep your phone on and be at the address. The rider may call you if they can’t find it.',
        '**Delivery code:** for your protection, the rider may ask for the code shown in your order before handing it over. Only share it when you receive your order.',
        '**If you can’t be reached:** the rider will try to contact you and wait a reasonable time. If the order still can’t be delivered through no fault of DOORSTEP, the store or the rider, it may be treated as delivered and may not be refunded.',
        '**Pickup orders:** collect your order from the store once it is ready. There is no delivery fee. The store can hold your order for a reasonable time only.',
        '**Parcel deliveries:** you must not send anything illegal, dangerous, stolen, perishable without suitable packaging, or worth more than you can afford to lose. Describe the item honestly. DOORSTEP and riders may refuse a parcel they reasonably believe breaks these rules.',
        '**Tips** are optional and go **100%** to the person who delivers your order (when a partner’s own rider delivers, the tip is paid to the partner to pass on in full).',
      ],
    },
    {
      id: 'cancellations', heading: 'Cancellations and refunds',
      list: [
        '**Before the store accepts:** you can cancel in the app free of charge, and you are refunded in full.',
        '**After the store accepts:** food and many other products are prepared specially for you, so you can no longer cancel in the app. Contact Help — we will try to help, but a refund is not guaranteed once preparation has started.',
        '**If the store declines your order, or we cancel it:** you receive a full refund.',
        '**If something is wrong** — an item missing, wrong, damaged, or the order never arrived — tell us through Help within **24 hours**, with a photo where possible. If the problem is confirmed, we will refund or credit the affected items or the whole order as appropriate.',
        '**How refunds are paid:** card payments are refunded to the same card through Paystack; your bank usually shows it within 5–10 working days. Bank-transfer payments are refunded by DOORSTEP to an account you give us.',
        'These rules do not limit any rights you have under the **Federal Competition and Consumer Protection Act 2018**.',
      ],
    },
    {
      id: 'partners-riders', heading: 'Partners and riders',
      paragraphs: ['If you sell or deliver through DOORSTEP, these points apply in addition to the Restaurant partner terms and Rider terms:'],
      list: [
        '**Approval:** we check partner and rider applications (including identity, CAC registration where given, and bank account names) before going live, and may refuse or suspend an account that doesn’t meet our standards or the law.',
        '**Partners** are responsible for their products, prices, opening hours, accurate menus, food safety and hygiene, and for having every licence and permit their business needs. They must accept or decline orders promptly and prepare them as described.',
        '**Commission:** DOORSTEP charges partners a commission on the item total of each order (not on fees). The standard rates are shown in the partner’s Earnings and may differ when a partner’s own rider delivers, or by written agreement.',
        '**Riders** are independent. They choose when to go online, must deliver safely, legally and with a suitable vehicle, treat customers and stores with respect, and keep orders sealed and safe. DOORSTEP keeps a service fee on each delivery earning, shown in the rider’s Earnings.',
        '**Payouts:** money owed to partners and riders is shown in their Earnings, with every order and fee listed. It is paid to the verified bank account on file, automatically, on a schedule, by withdrawal request or by DOORSTEP by hand, as set out in the app. A withdrawal fee may apply and is always shown before you confirm. Payments made by hand must be confirmed as received in the app; if you don’t respond within three days, the payment is treated as received.',
        '**Deductions:** refunds caused by a partner’s or rider’s mistake, and amounts paid to you in error, may be deducted from future earnings. You will see every deduction in your statement with the reason.',
      ],
    },
    {
      id: 'reviews', heading: 'Reviews and content',
      list: [
        'Reviews must be honest, about your own order, and must not be abusive, discriminatory, misleading, or contain personal details of others. We may remove reviews that break these rules.',
        'Reviews are shown with your first name and surname initial. By posting one you allow DOORSTEP to display it on the Platform.',
        'Partners keep the rights to their photos, logos and descriptions, and allow DOORSTEP to show them on the Platform and in promoting it.',
      ],
    },
    {
      id: 'acceptable-use', heading: 'Using DOORSTEP fairly',
      paragraphs: ['You must not:'],
      list: [
        'use DOORSTEP for anything illegal, or order or send anything illegal;',
        'abuse, threaten or harass riders, partners, customers or DOORSTEP staff;',
        'commit fraud, including false refund claims, fake orders, chargebacks you know are unjustified, or misusing promotions;',
        'interfere with the Platform’s security or operation, copy or scrape it, or access accounts that aren’t yours.',
      ],
      after: ['We may suspend or close an account, cancel orders or withhold promotions where we reasonably believe these rules have been broken, and we may report crimes to the police.'],
    },
    {
      id: 'ip', heading: 'DOORSTEP’s name and software',
      paragraphs: ['The DOORSTEP name, logo, apps and website belong to DOORSTEP. You may use them only to use the Platform as intended. Nothing in these Terms gives you any other right to them.'],
    },
    {
      id: 'liability', heading: 'Our responsibility to you',
      list: [
        'We will provide our part of the service with reasonable care and skill. If we don’t, you are entitled to a remedy, such as a refund.',
        'Partners are responsible for the products they sell, and riders for how they carry out deliveries. DOORSTEP is responsible for its own acts and omissions.',
        'We are not responsible for losses we could not reasonably foresee, for business losses of partners or riders beyond what these Terms or the partner and rider terms say, or for delays or failures caused by events outside our reasonable control (such as severe weather, flooding, road closures, unrest, network or power outages).',
        'Where the law allows a limit, our total liability for any one order is limited to the amount you paid for it.',
        '**Nothing in these Terms excludes or limits** liability for death or personal injury caused by negligence, for fraud, or any other liability, or any of your rights, that cannot be excluded or limited under Nigerian law, including the FCCPA.',
      ],
    },
    {
      id: 'suspension', heading: 'Suspension and ending these Terms',
      paragraphs: ['You may stop using DOORSTEP and close your account at any time. We may suspend or close an account, with notice where reasonable, if these Terms are broken, if required by law, or to protect users or the Platform. Money properly owed to a partner or rider at that time will still be paid, less any amounts properly deducted.'],
    },
    {
      id: 'changes', heading: 'Changes to the service and to these Terms',
      paragraphs: ['We may change the Platform and these Terms, for example to add features, meet legal requirements or reflect how DOORSTEP works. We will show the new date at the top and tell you in the app or by email before important changes take effect. Orders already placed follow the Terms that applied when you placed them. If you don’t agree to a change, you can close your account.'],
    },
    {
      id: 'law', heading: 'Complaints, governing law and disputes',
      list: [
        `**Complaints:** please contact Help in the app or **${LEGAL_ENTITY.email}** first. We aim to respond within 2 working days and to resolve complaints quickly and fairly.`,
        'If you are not satisfied, you may contact the **Federal Competition and Consumer Protection Commission (FCCPC)**.',
        'These Terms are governed by the **laws of the Federal Republic of Nigeria**. Disputes that we cannot resolve together will be decided by the courts of competent jurisdiction in **Delta State, Nigeria**, without affecting your right as a consumer to bring a claim where the law allows.',
      ],
    },
    {
      id: 'general', heading: 'General',
      paragraphs: ['If any part of these Terms is found invalid, the rest still applies. If we don’t enforce a right straight away, we can still enforce it later. These Terms, together with the Privacy Policy and (for partners and riders) the partner and rider terms, are the whole agreement between you and DOORSTEP about using the Platform.'],
    },
    {
      id: 'contact', heading: 'Contact us',
      paragraphs: [`DOORSTEP — ${LEGAL_ENTITY.address}. Email: **${LEGAL_ENTITY.email}**. You can also reach us through Help in the app.`],
    },
  ],
}
