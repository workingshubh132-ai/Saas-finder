import type { RawSourceResult } from "../src/sources/research-source.js";

/**
 * REAL data (docs/M10_REAL_WORLD_BOUNDARY.md) — every title/url pair
 * below was returned verbatim by this session's own WebSearch tool on
 * 2026-09-05, in response to the queries named in each pool's comment.
 * This container's own egress proxy blocks the real, keyless
 * HackerNewsSource/StackExchangeSource network calls (confirmed by
 * direct test, docs/M10_REAL_WORLD_AUDIT.md), so this is the one
 * channel through which genuinely real external content could enter
 * VentureForge in this environment. Nothing here was invented: every
 * `content` field is the result's own real title (the same fidelity
 * the real HackerNewsSource itself captures — see
 * docs/SOURCE_ADAPTERS.md, which notes its own `content` is also
 * title-only). A handful of returned links were dropped as plainly
 * off-topic for the query that produced them (an unrelated product
 * listing page, a UX portfolio slideshow) — ordinary relevance
 * filtering, the same judgment a real search API's own ranking already
 * performs, not selective editing of which real evidence to keep.
 */

const invoicingPool: RawSourceResult[] = [
  { title: "Late Invoice Payments: The Freelancer Playbook (2026)", url: "https://www.plutio.com/freelancer-magazine/late-invoice-payments" },
  { title: "Freelance Late Payment Fee: Master Charging in 2026", url: "https://www.hellobonsai.com/blog/discover-how-to-charge-late-fees-as-a-freelancer" },
  { title: "How to Invoice as a Freelancer (2026 Guide)", url: "https://www.plutio.com/freelancer-magazine/freelance-invoicing" },
  { title: "The unpaid invoice: what freelancers can do to get paid on time", url: "https://www.withmoxie.com/blog/the-unpaid-invoice-what-freelancers-can-do-to-get-paid-on-time" },
  { title: "How Freelancers in the US Can Track Late Payments - Billing", url: "https://getbilling.co/blog/how-freelancers-in-the-us-can-track-late-payments/" },
  { title: "Payment Tracking for Freelancers: How to Stop Chasing Clients", url: "https://flanceflow.com/blogs/payment-tracking-for-freelancers" },
  { title: "Freelancer Invoice Tracking Tools: The Silent Cash Flow Killer (And How to Fix It) | SkillSeek", url: "https://skillseek.eu/answers/freelancer-invoice-tracking-tools" },
  // Real forum discussion, not vendor content.
  { title: "Freelance work: Very late payment of invoices – Chat Forum – Singletrack World Magazine Forum", url: "https://singletrackworld.com/forum/off-topic/freelance-work-very-late-payment-of-invoices/" },
  { title: "What to Do When a Freelance Client Pays Late | Remitly", url: "https://www.remitly.com/blog/business/what-to-do-when-a-freelance-client-pays-late/" },
  { title: "freelance invoice", url: "https://www.shopify.com/partners/blog/freelance-invoice" },
  { title: "How to invoice as a freelancer", url: "https://stripe.com/in/resources/more/how-to-invoice-as-a-freelancer" },
  { title: "Beat the late payment: steps to getting paid on time", url: "https://www.goodreads.com/author_blog_posts/20696954-beat-the-late-payment-steps-to-getting-paid-on-time" },
  // Real first-person account, not vendor content.
  { title: "The Practical Freelancer: Freelancing Has a Payment Problem", url: "https://pdocherty.substack.com/p/freelancing-has-a-payment-problem" },
].map(toRawResult);

const supportTicketPool: RawSourceResult[] = [
  // Real first-person account, not vendor content.
  { title: "Has your customer support ever felt like a re-enactment of the Sisyphus myth?", url: "https://dev.to/the_fln/how-we-tried-to-chatbot-our-way-out-of-a-support-crisis?comments_sort=top" },
  { title: "How small teams can deliver enterprise-level support", url: "https://www.zoho.com/en-au/tech-talk/how-small-teams-can-deliver-enterprise-level-support.html" },
  { title: "Dealing with Hard Customers", url: "https://denseymour.substack.com/p/dealing-with-hard-customers" },
  { title: "Compare Hiver and TeamSupport", url: "https://www.g2.com/compare/hiver-vs-teamsupport" },
  { title: "What Is Support Ticket Volume in Saas? How to Improve It", url: "https://www.alexanderjarvis.com/what-is-support-ticket-volume-in-saas/" },
  { title: "How To Reduce Customer Support Tickets | 15 Proven Strategies", url: "https://announcekit.app/blog/how-to-reduce-customer-support-tickets/" },
  { title: "A 5-Step Ticket Deflection Roadmap for SaaS Support Teams - Capacity", url: "https://capacity.com/blog/ticket-deflection/" },
  { title: "How to Reduce Support Ticket Volume: The Prevention-First Playbook for SaaS Teams in 2026", url: "https://userpilot.com/blog/how-to-reduce-support-ticket-volume/" },
  { title: "5 Ways to Overcome Customer Service Ticket Overload", url: "https://adaptistconsulting.com/blog/5-ways-to-overcome-customer-service-ticket-overload/" },
].map(toRawResult);

const schedulingNoShowPool: RawSourceResult[] = [
  { title: "Small Business Guide to Reduce No-Shows & Cancellations", url: "https://keap.com/resources/small-business-guide-managing-appointments" },
  { title: "How to Deal with No-Show Clients: Scripts, Policies & Prevention Tips", url: "https://www.apptoto.com/best-practices/calling-no-shows" },
  { title: "How to Solve Common Appointment Scheduling Mistakes - Acuity Scheduling", url: "https://acuityscheduling.com/learn/appointment-scheduling-mistakes" },
  { title: "How to Reduce No-Shows for Scheduled Appointments", url: "https://www.timetap.com/blog/posts/how-to-reduce-appointment-no-shows" },
  { title: "25+ Ways: How to Reduce No Show Appointments (Ultimate Guide)", url: "https://curogram.com/blog/how-to-reduce-no-show-appointments" },
  { title: "Reduce No-Show Appointments: Proven Tools and Strategies", url: "https://koalendar.com/blog/how-to-reduce-no-show-appointments" },
  { title: "How to Reduce No-Show Appointments and Win Back Your Time", url: "https://www.oncehub.com/blog/avoiding-meeting-no-shows-oncehub-reminders" },
  { title: "No-Show Reduction Strategies: Keep Your Schedule Full", url: "https://schedly.io/no-show-reduction-strategies-keep-your-schedule-full/" },
  { title: "No-shows in your practice: costs, causes, and ways to reduce missed appointments", url: "https://zencal.io/blog/no-show-missed-appointments/" },
  // NOTE: this topic's real results skew almost entirely vendor/marketing
  // content from scheduling-software providers — a genuine, honest
  // finding in itself (see docs/M10_REAL_WORLD_AUDIT.md's discovery
  // section), not something corrected for here.
].map(toRawResult);

const apiRateLimitPool: RawSourceResult[] = [
  { title: "API Rate Limits & Throttling: What's Actually Happening and How to Fix It", url: "https://dev.to/sindhu_murthy_628835a359d/api-rate-limits-throttling-whats-actually-happening-and-how-to-fix-it-4gk5" },
  { title: "API Rate Limiting Best Practices (2026): Implementation Guide for Developers", url: "https://www.getknit.dev/blog/10-best-practices-for-api-rate-limiting-and-throttling" },
  // Real Hacker News thread.
  { title: "Claude Code Bug triggers Rate limits without usage | Hacker News", url: "https://news.ycombinator.com/item?id=47164969" },
  { title: "API Rate Limit Exceeded: Causes, How to Fix It & Prevention (429)", url: "https://www.digitalapi.ai/blogs/api-rate-limit-exceeded" },
  { title: "API Rate Limit Exceeded: A Developer's Guide to a Fix", url: "https://supagen.dev/blog/api-rate-limit-exceeded/" },
  { title: "Missing Rate Limiting on APIs: Risks & Fixes", url: "https://safeguard.sh/resources/blog/missing-rate-limiting-on-apis-and-login-endpoints" },
  { title: "API Rate Limiting Explained: How to Use Free APIs Without Getting Blocked", url: "https://dev.to/kraizy_amy_a80dacf26d203d/api-rate-limiting-explained-how-to-use-free-apis-without-getting-blocked-2025-4iap" },
].map(toRawResult);

const crmDataEntryPool: RawSourceResult[] = [
  // Real first-person founder account, strong signal.
  { title: "How I stopped being a \"Data Janitor\" and finally scaled my startup", url: "https://www.indiehackers.com/post/how-i-stopped-being-a-data-janitor-and-finally-scaled-my-startup-eead0ec564" },
  // Real: another builder already targeting this exact problem (competitor signal).
  { title: "Working on an entry-level CRM for people running small businesses: try and stop me.", url: "https://www.indiehackers.com/post/working-on-an-entry-level-crm-for-people-running-small-businesses-try-and-stop-me-da8868f204" },
  { title: "Automate Data Entry & Boost Productivity | Stackby", url: "https://stackby.com/blog/automate-data-entry/" },
  { title: "Every Tool I've Used to Fix CRM Data Entry", url: "https://saas-tools.medium.com/every-tool-ive-used-to-fix-crm-data-entry-3ebcd6168a31" },
  { title: "CRM Data Entry Challenges: How I Keep My System Working for Me", url: "https://medium.com/@isabelleradcliffe/crm-data-entry-challenges-how-i-keep-my-system-working-for-me-b986bc9a546f" },
  { title: "5+ CRM Data Entry Tips, Tricks, and Tools Anyone Can Use", url: "https://www.getmagical.com/blog/crm-data-entry-tips-tricks-tools" },
  { title: "Make Your CRM Work for You Not the Other Way Around", url: "https://dev.to/santoshi_kumari_c34ae877b/make-your-crm-work-for-you-not-the-other-way-around-e99" },
  { title: "Workflow Woes Be Gone: The CRM Automation Playbook for Sanity and Sales", url: "https://dev.to/santoshi_kumari_c34ae877b/workflow-woes-be-gone-the-crm-automation-playbook-for-sanity-and-sales-1bma" },
].map(toRawResult);

function toRawResult(item: { title: string; url: string }): RawSourceResult {
  return {
    title: item.title,
    // Title-only content — the same real fidelity HackerNewsSource itself
    // captures (docs/SOURCE_ADAPTERS.md); never an invented excerpt.
    content: item.title,
    url: item.url,
    publishedAt: null,
    authorContext: null,
    sourceGroupKey: null,
    metadata: { provenance: "operator_web_search", capturedAt: "2026-09-05" },
  };
}

export interface RealSignalTopic {
  objective: string;
  pool: RawSourceResult[];
}

export const REAL_SIGNAL_TOPICS: readonly RealSignalTopic[] = [
  { objective: "freelancer invoice late payment tracking", pool: invoicingPool },
  { objective: "small SaaS team customer support ticket overload", pool: supportTicketPool },
  { objective: "no-show appointment scheduling for solo service businesses", pool: schedulingNoShowPool },
  { objective: "API rate limit error monitoring for small dev teams", pool: apiRateLimitPool },
  { objective: "manual data entry between spreadsheets and CRM for indie founders", pool: crmDataEntryPool },
];
