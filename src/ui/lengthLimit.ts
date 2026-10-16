// src/ui/lengthLimit.ts — mw-gq6.464: a text box with a limit never uses maxLength, which cuts a paste silently. It keeps
// the text whole, LengthNote counts it, and the button that sends it is off while it is too long.

/** The share of the limit at which the count first shows. */
export const LENGTH_NEAR = 0.9;

/** The length `text` has as it would be sent (trimmed). */
export const sentLength = (text: string): number => text.trim().length;

/** Whether `text` is past `max` as it would be sent. */
export const isTooLong = (text: string, max: number): boolean => sentLength(text) > max;
