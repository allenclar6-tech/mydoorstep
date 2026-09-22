export const categories = [
  { name: 'All food', icon: '✦' },
  { name: 'Jollof & rice', icon: '🍚' },
  { name: 'Swallow', icon: '🥣' },
  { name: 'Grills', icon: '🍗' },
  { name: 'Breakfast', icon: '🍳' },
  { name: 'Drinks', icon: '🥤' },
]

export const sapeleLocations = [
  'Amukpe',
  'Central Sapele',
  'New Road',
  'Ogodo',
  'Sapele Township',
  'Market Road',
  'Mission Road',
  'Warri-Sapele Road',
  'Benin-Sapele Road',
  'Urban Area',
  'Okpe Road',
  'Oton Road',
  'Oghara Junction',
  'Estate Area',
  'Hospital Road',
  'School Road',
  'Water Side',
  'Mosogar Road',
  'Jesse Road',
  'Other Sapele location',
]

export const restaurants = [
  {
    id: 'restaurant-palm',
    name: 'The Palm Kitchen',
    cuisine: 'Nigerian · Local favourites',
    rating: '4.8',
    time: '25–35 min',
    fee: '₦800 delivery',
    category: 'Jollof & rice',
    image: 'https://images.unsplash.com/photo-1604329760661-e71dc83f8f26?auto=format&fit=crop&w=1000&q=85',
    accent: 'coral',
    items: [
      { id: 'palm-1', name: 'Smoky party jollof', description: 'Long-grain jollof, fried plantain and your choice of protein.', price: 3500, image: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=700&q=85', tag: 'Best seller' },
      { id: 'palm-2', name: 'Peppered chicken', description: 'Charred chicken tossed in a bright, peppery sauce.', price: 4200, image: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=700&q=85', tag: 'Spicy' },
      { id: 'palm-3', name: 'Plantain & egg sauce', description: 'Sweet fried plantain with rich, soft scrambled eggs.', price: 2800, image: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=700&q=85', tag: 'New' },
    ],
  },
  {
    id: 'restaurant-nana',
    name: 'Nana’s Pot',
    cuisine: 'Soups · Swallow · Comfort food',
    rating: '4.7',
    time: '30–40 min',
    fee: '₦700 delivery',
    category: 'Swallow',
    image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=1000&q=85',
    accent: 'leaf',
    items: [
      { id: 'nana-1', name: 'Banga soup & starch', description: 'Delta-style banga soup with tender beef and starch.', price: 4500, image: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=700&q=85', tag: 'Local pick' },
      { id: 'nana-2', name: 'Pounded yam & egusi', description: 'Silky pounded yam served with deep, nutty egusi.', price: 4000, image: 'https://images.unsplash.com/photo-1604329760661-e71dc83f8f26?auto=format&fit=crop&w=700&q=85', tag: '' },
    ],
  },
  {
    id: 'restaurant-firewood',
    name: 'Firewood Grill',
    cuisine: 'Grills · Suya · Small chops',
    rating: '4.9',
    time: '20–30 min',
    fee: '₦600 delivery',
    category: 'Grills',
    image: 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?auto=format&fit=crop&w=1000&q=85',
    accent: 'gold',
    items: [
      { id: 'fire-1', name: 'Beef suya box', description: 'Smoky skewers, onions, tomatoes and yaji spice.', price: 5000, image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=700&q=85', tag: 'Hot right now' },
      { id: 'fire-2', name: 'Charcoal chicken wings', description: 'Eight sticky, smoky wings with pepper sauce.', price: 4800, image: 'https://images.unsplash.com/photo-1527477396000-e27163b481c2?auto=format&fit=crop&w=700&q=85', tag: '' },
    ],
  },
]

export const formatNaira = (amount) => `₦${amount.toLocaleString('en-NG')}`
