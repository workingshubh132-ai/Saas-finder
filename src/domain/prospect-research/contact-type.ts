/**
 * Public business contact-channel typing (docs/DISCOVERY_EXPERIMENT_VERTICAL_SLICE.md).
 * A channel is one of these types, backed by a real source description
 * — never a personal channel, never guessed.
 */
export const CONTACT_TYPES = ["EMAIL", "CONTACT_FORM", "PHONE", "WHATSAPP", "DIRECTORY", "OTHER"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export function isContactType(value: string): value is ContactType {
  return (CONTACT_TYPES as readonly string[]).includes(value);
}

/** A WhatsApp deep-link/API path — the one structural signal that actually proves a channel is WhatsApp. */
const WHATSAPP_URL_PATTERN = /(?:wa\.me\/|api\.whatsapp\.com\/|whatsapp:\/\/)/i;
/** The business's own public text explicitly naming the channel as WhatsApp. */
const WHATSAPP_WORD_PATTERN = /whatsapp/i;

/**
 * A phone number must never be auto-classified as WhatsApp (Phase 1/4's
 * explicit rule) — many phone numbers happen to also run WhatsApp, but
 * that is an inference this codebase is not allowed to make silently.
 * This is the one place that claim is actually checked, not merely
 * requested of the model: WHATSAPP is kept only when the contact
 * channel URL itself is a WhatsApp deep link, OR the contact source
 * text the researcher actually extracted explicitly names WhatsApp
 * (e.g. "WhatsApp button on the contact page"). Any other case is
 * downgraded to PHONE — never dropped, never silently re-labeled as
 * something else that hides the downgrade.
 */
export function verifyContactType(params: { claimedType: string; contactSource: string; publicContactChannel: string }): ContactType {
  const claimed = isContactType(params.claimedType) ? params.claimedType : "OTHER";
  if (claimed !== "WHATSAPP") return claimed;

  const hasUrlEvidence = WHATSAPP_URL_PATTERN.test(params.publicContactChannel);
  const hasTextEvidence = WHATSAPP_WORD_PATTERN.test(params.contactSource) || WHATSAPP_WORD_PATTERN.test(params.publicContactChannel);
  if (hasUrlEvidence || hasTextEvidence) return "WHATSAPP";

  return "PHONE";
}
