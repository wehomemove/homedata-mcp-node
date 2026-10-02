/**
 * The Home plugin package's own listing rules. Home exists to find homes for
 * sale and to rent, so unlike Homedata it may say so; it still never claims to
 * value a home. It needs no account and takes no payments, so its listing says
 * nothing about paying and every pricing or offer word stays banned.
 */
import type { PackageRules } from "../plugin-package.js";

export const HOME_RULES: PackageRules = {
  paidDisclosure: null,
  commerceDescription: "Home is read-only and needs no account. It takes no payments and sells nothing in ChatGPT.",
  outOfScope: /\bvalu(e|es|ed|ing|ation|ations)\b|\bworth\b/i,
  outOfScopeLabel: "a valuation",
};
