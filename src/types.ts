import type { generateFonts, RunnerOptions } from 'fantasticon'

export interface Options extends Partial<RunnerOptions> {
  /**
   * Function to generate fonts, defaults to `fantasticon`'s `generateFonts`.
   * You can provide a custom implementation if needed.
   */
  generateFonts?: typeof generateFonts

  /**
   * Whether to inject HTML for the generated icons.
   * If set to `true`, the plugin will inject HTML into the output files.
   * Defaults to `true`.
   * @default true
   */
  injectHtml?: boolean
}
