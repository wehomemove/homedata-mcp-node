/**
 * The Homemove plugin package's listing rules. Homemove quotes moving services,
 * valuations among them, so a valuation is in scope; what it never does in
 * ChatGPT is advise on mortgages, recommend lenders or insurers, or quote an
 * insurance premium: home insurance and mortgages are homemove.com's own regulated
 * flows, which the app only opens. It takes no payments in ChatGPT: booking happens
 * on homemove.com.
 */
import type { PackageRules } from "../plugin-package.js";

export const HOMEMOVE_RULES: PackageRules = {
  paidDisclosure: null,
  commerceDescription: "Homemove takes no payments and sells nothing in ChatGPT. Quotes need no account; booking happens on homemove.com.",
  outOfScope: /\bmortgage advice\b|\brecommend(s|ed|ing)? (an? )?(lenders?|insurers?)\b|\binsurance (quotes?|premiums?|advice)\b/i,
  outOfScopeLabel: "mortgage advice, lender or insurer recommendations, or insurance quotes",
};
