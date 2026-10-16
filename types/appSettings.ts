/** App-wide settings managed on the Settings page (not tied to any one event, menu or profile). */
export type AppSettings = {
  /** Phone number on the back cover of banqueting menu cards; blank = not printed. */
  contactPhone: string;
  /** Web addresses line under the phone number on menu cards; blank = not printed. */
  contactWebsites: string;
  /** Background used for buffet display menus that don't pick their own. */
  defaultDisplayBackgroundKey: string;
};
