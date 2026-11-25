type BillingEnv = Record<string, string | undefined>;
type Warn = (message: string) => void;

export const PILOT_REQUEST_HREF: '/#waitlist-heading';
export function formatAnnualPrice(config: { currency: string; priceUsdPerYear: number }): string;
export function parsePricingFlag(env?: BillingEnv): boolean | undefined;
export function getCheckoutUrl(env?: BillingEnv, warn?: Warn): string | undefined;
export function getPilotRequestUrl(env?: BillingEnv, warn?: Warn): string | undefined;
