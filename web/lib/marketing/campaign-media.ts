export type CampaignImage = {
  src: string;
  prompt: string;
  alt: string;
};

/**
 * Original fictional campaign imagery generated for the marketer.sh site.
 * Keeping the set centralized makes the orbit, gallery, product demo, and
 * closing fan feel like one creative reel instead of unrelated stock photos.
 */
export const CAMPAIGN_IMAGES: CampaignImage[] = [
  {
    src: "/campaign/01-nimbry-modules.jpg",
    prompt: "translucent modules, cobalt field, hard studio light",
    alt: "Five translucent white, orange, and lime resin modules floating over a cobalt background.",
  },
  {
    src: "/campaign/02-velorin-pouch.jpg",
    prompt: "wellness pouch, warm flash, charcoal linen",
    alt: "A hand holding a coral Velorin pouch over charcoal linen.",
  },
  {
    src: "/campaign/03-citrune-chews.jpg",
    prompt: "fruit chew packet, pistachio knit, direct flash",
    alt: "Hands opening a green and yellow Citrune fruit chew packet.",
  },
  {
    src: "/campaign/04-golden-heart.jpg",
    prompt: "golden heart chew, blue sky, beauty close-up",
    alt: "A smiling person holding a translucent golden heart-shaped chew against a blue sky.",
  },
  {
    src: "/campaign/05-tangerine-gel.jpg",
    prompt: "tangerine gel, macro compression, warm caustics",
    alt: "A fingertip compressing a translucent tangerine gel object on a ceramic plinth.",
  },
  {
    src: "/campaign/06-lilac-fashion.jpg",
    prompt: "lilac bag, chrome tailoring, civic plaza",
    alt: "A fashion model carrying a sculptural lilac bag in a sunlit glass plaza.",
  },
  {
    src: "/campaign/07-colorblock-sock.jpg",
    prompt: "color-block sock, cyan seamless, graphic flash",
    alt: "A hand adjusting an ivory performance sock with coral and cobalt accents.",
  },
  {
    src: "/campaign/08-cabin-collection.jpg",
    prompt: "accessory collection, sleeper train, warm symmetry",
    alt: "A retro-futurist train carriage with colorful accessories displayed on seatback screens.",
  },
  {
    src: "/campaign/09-lumetta-skincare.jpg",
    prompt: "sculptural skincare, tomato red, crisp shadows",
    alt: "Chrome, peach glass, and lilac Lumetta skincare vessels on a red background.",
  },
  {
    src: "/campaign/10-tavona-pool.jpg",
    prompt: "cobalt can, lime pool ledge, sun caustics",
    alt: "A cold blue Tavona can with coral sunglasses and an orange beside a pool.",
  },
  {
    src: "/campaign/11-crimson-jelly-bag.jpg",
    prompt: "crimson jelly bag, turquoise sky, refracted sun",
    alt: "A translucent crimson handbag held against a pale turquoise sky.",
  },
  {
    src: "/campaign/12-orange-headphones.jpg",
    prompt: "silver headphones, orange cushions, mint plinth",
    alt: "Silver headphones with orange cushions balanced on a mint geometric plinth.",
  },
];

export const CAMPAIGN_SRCS = CAMPAIGN_IMAGES.map((image) => image.src);
