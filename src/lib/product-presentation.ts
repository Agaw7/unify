/** Display-only catalog branding; product IDs, prices and contract terms are unchanged. */
const products: Record<string, { name: string; image: string }> = {
  'UDM Pro Gateway': { name: 'Aromeva Golden Lantern', image: '/products/aurevia-lantern.jpg' },
  'G5 Flex Camera': { name: 'Silk Lantern Set', image: '/products/aurevia-lantern.jpg' },
  'G5 Dome Camera': { name: 'Masala Chai Crate', image: '/products/aurevia-spiced-tea.jpg' },
  'G5 Bullet Camera': { name: 'Mexican Vanilla Pods', image: '/products/aurevia-vanilla.jpg' },
  'UniFi U6 Pro AP': { name: 'Persian Saffron Tin', image: '/products/aurevia-saffron.jpg' },
  'G4 Doorbell Pro': { name: 'Alpine Chocolate', image: '/products/aurevia-chocolate.jpg' },
  'UNVR 4-Bay NVR': { name: 'Yirgacheffe Beans', image: '/products/aurevia-coffee.jpg' },
  'G5 Pro 4K Camera': { name: 'Matcha Whisk Kit', image: '/products/aurevia-matcha.jpg' },
};
export const productDisplayName = (name: string) => products[name]?.name ?? name;
export const productDisplayImage = (name: string) => products[name]?.image ?? '/products/' + encodeURIComponent(name) + '.jpg';

export const isCatalogProduct = (name: string) => name !== 'UDM Pro Gateway';

const details: Record<string, { country: string; tier: number; description: string; symbol: string }> = {
 'G5 Flex Camera': {country:'🇻🇳 Vietnam',tier:7,description:'A silk lantern-inspired plan with warm festival colors and delicate woven details.',symbol:'🏮'},
 'G5 Dome Camera': {country:'🇮🇳 India',tier:6,description:'A masala chai-inspired plan with cardamom, clove and ginger in a pastel tea collection.',symbol:'🫖'},
 'G5 Bullet Camera': {country:'🇲🇽 Mexico',tier:5,description:'A vanilla-inspired plan with fragrant pods, soft ivory tones and little paper bundles.',symbol:'🌼'},
 'UniFi U6 Pro AP': {country:'🇮🇷 Iran',tier:4,description:'A saffron-inspired plan with crimson threads and an ornate golden tin.',symbol:'🌸'},
 'G4 Doorbell Pro': {country:'🇨🇭 Switzerland',tier:3,description:'An alpine chocolate-inspired plan with golden wrappers and mountain-milk colors.',symbol:'🍫'},
 'UNVR 4-Bay NVR': {country:'🇪🇹 Ethiopia',tier:2,description:'A coffee-inspired plan with roasted beans, a woven sack and a warm little cup.',symbol:'☕'},
 'G5 Pro 4K Camera': {country:'🇯🇵 Japan',tier:1,description:'A matcha-inspired plan with a bamboo whisk, ceremonial bowl and soft green tones.',symbol:'🍵'},
};
export const productDetails = (name: string) => details[name];
