// Fixtures for the SEO article previews (/preview/app/seo/*). Images are local
// placeholders standing in for hotlinked Unsplash photos.
import { FX_ARTICLES } from "@/lib/fixtures-work";
import type { ArticleBatch, SeoArticle, UnsplashPhoto, WordPressConnection } from "@/lib/seo";

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const utm = "?utm_source=marketer&utm_medium=referral";

export const FX_WORDPRESS: WordPressConnection = {
  connected: true,
  site_url: "https://journal.pastaclub.co",
  username: "sam",
  seo_plugin: "yoast",
  status: "active",
  last_error: "",
  has_password: true,
  can_publish: true,
  secrets_configured: true,
};

export const FX_WORDPRESS_OFF: WordPressConnection = { connected: false, site_url: null, username: null, seo_plugin: null, status: null, last_error: "", has_password: false, can_publish: null, secrets_configured: true };

export const FX_SEO_ARTICLE: SeoArticle = {
  ...FX_ARTICLES[0]!,
  meta_title: "Fresh Pasta at Home: 3 Habits Restaurant Cooks Swear By",
  meta_description: "Make silky fresh pasta at home with three habits restaurant cooks swear by: more water, proper salt, and finishing in the sauce.",
  research: {
    query: "fresh pasta at home",
    model: "perplexity/sonar",
    notes: "",
    flagged: 0,
    fetched_at: ago(200),
    sources: [
      { url: "https://www.seriouseats.com/fresh-pasta-dough", title: "The Food Lab: fresh pasta dough", domain: "seriouseats.com", snippet: "" },
      { url: "https://www.bonappetit.com/story/salt-pasta-water", title: "How much salt goes in pasta water", domain: "bonappetit.com", snippet: "" },
      { url: "https://www.kingarthurbaking.com/blog/pasta-flour", title: "Choosing flour for homemade pasta", domain: "kingarthurbaking.com", snippet: "" },
    ],
  },
  cover_image: {
    source: "unsplash",
    id: "fx-cover",
    url: "/images/preview/cover.webp",
    thumb_url: "/images/preview/cover.webp",
    alt: "Fresh tagliatelle nests dusted with flour",
    author_name: "Giulia Rossi",
    author_url: `https://unsplash.com/@giulia${utm}`,
    photo_url: `https://unsplash.com/photos/fx-cover${utm}`,
    unsplash_url: `https://unsplash.com/${utm}`,
    attribution: "Photo by Giulia Rossi on Unsplash",
  },
  publish_status: "none",
};

export const FX_SEO_SCHEDULED: SeoArticle = { ...FX_SEO_ARTICLE, publish_status: "scheduled", publish_mode: "live", publish_at: ahead(30) };
export const FX_SEO_LIVE: SeoArticle = { ...FX_SEO_ARTICLE, publish_status: "published", publish_mode: "live", wp_post_id: 321, wp_post_url: "https://journal.pastaclub.co/fresh-pasta-at-home/", published_at: ago(20) };
export const FX_SEO_UNKNOWN: SeoArticle = { ...FX_SEO_ARTICLE, publish_status: "unknown", publish_error: "We sent the article and got no answer. Check WordPress before trying again." };
export const FX_SEO_NO_COVER: SeoArticle = { ...FX_SEO_ARTICLE, cover_image: null };

const names = ["Luca Bianchi", "Mara Lind", "Theo Park", "Ines Duarte", "Sora Ito", "Ada Kowal"];
export const FX_UNSPLASH: UnsplashPhoto[] = names.map((n, i) => ({
  id: `fx-${i + 1}`,
  url: `/images/preview/photo-${i + 1}.webp`,
  thumb_url: `/images/preview/photo-${i + 1}.webp`,
  alt: "Pasta on a kitchen counter",
  width: 600,
  height: 400,
  author_name: n,
  author_url: `https://unsplash.com/@fx${i}${utm}`,
  photo_url: `https://unsplash.com/photos/fx-${i + 1}${utm}`,
  unsplash_url: `https://unsplash.com/${utm}`,
}));

const kw = ["best flour for fresh pasta", "how to store fresh pasta", "pasta machine vs rolling pin", "egg yolk pasta dough", "semolina vs 00 flour", "how long to cook fresh pasta"];
export const FX_BATCHES: ArticleBatch[] = [
  {
    id: "b1",
    niche_id: "n1",
    status: "paused_cap",
    total: kw.length,
    created_at: ago(3),
    items: kw.map((k, i) => ({
      id: `bi${i}`,
      position: i + 1,
      keyword: k,
      status: i < 2 ? "done" : i === 2 ? "failed" : i === 3 ? "running" : "queued",
      held_reason: i > 3 ? "spend_cap" : null,
      article_id: i < 4 ? `a${i + 1}` : null,
      error: i === 2 ? "Research found nothing ranking." : null,
    })),
  },
  { id: "b2", niche_id: "n2", status: "done", total: 3, created_at: ago(70), items: ["pan sauce basics", "deglazing with wine", "beurre blanc"].map((k, i) => ({ id: `bj${i}`, position: i + 1, keyword: k, status: "done", held_reason: null, article_id: `a${i + 1}`, error: null })) },
];
