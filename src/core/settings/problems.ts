/**
 * What the plugin found wrong in the settings, and the words that state it
 * to the user.
 *
 * The settings arrive as data that the plugin did not write. A user can
 * edit the data file by hand, a sync tool can join two versions of it, and
 * an older version of the plugin can write a field with another shape. The
 * plugin therefore reads each entry and each field, and it refuses a value
 * that it cannot use.
 *
 * Each fault names the field that holds the wrong value. Each problem
 * names the entry that holds that field. The user must see which entry and
 * which field to correct, because the plugin corrects nothing by itself.
 *
 * A refused entry is not part of the settings that the plugin uses. A
 * later write of the settings does not carry that entry, so the settings
 * screen states every problem that a read found.
 *
 * No message holds a credential. A message quotes the value of a field
 * only where that field belongs to the settings, and no field of the
 * settings holds a credential.
 */

/**
 * The fields of an account, together with the app password. The settings
 * hold no password: the password stands in the secret store. The settings
 * screen shows the password beside the other fields of the account, so a
 * fault of that entry needs a name here. A fault of the password states
 * that the field holds no characters, and it quotes no value.
 */
export type AccountField =
	| 'id'
	| 'serverUrl'
	| 'username'
	| 'credentialType'
	| 'credentialRef'
	| 'password';

export type CalendarField =
	| 'name'
	| 'source'
	| 'accountId'
	| 'collectionHref'
	| 'mode'
	| 'components'
	| 'defaultTimezone'
	| 'color';

export type EntryField = AccountField | CalendarField;

/** One fault in one field of one entry. */
export type FieldFault =
	/** The entry has no such field. */
	| { readonly kind: 'missing'; readonly field: EntryField }
	/** The field holds a value that is not text. */
	| { readonly kind: 'not-text'; readonly field: EntryField }
	/** The field holds text with no characters. */
	| { readonly kind: 'empty'; readonly field: EntryField }
	/** The field holds a value that is not a list. */
	| { readonly kind: 'not-a-list'; readonly field: EntryField }
	/** The field holds a word that the field does not take. */
	| {
			readonly kind: 'unknown-value';
			readonly field: EntryField;
			readonly value: string;
			readonly permitted: readonly string[];
	  }
	/** The field holds text that is not a web address. */
	| {
			readonly kind: 'not-a-web-address';
			readonly field: EntryField;
			readonly value: string;
	  }
	/** The field holds a character that the field does not take. */
	| {
			readonly kind: 'alphabet';
			readonly field: EntryField;
			readonly value: string;
	  }
	/** Another entry holds the same value in the same field. */
	| {
			readonly kind: 'repeated';
			readonly field: EntryField;
			readonly value: string;
	  };

/** The two lists of entries that the settings hold. */
export type SettingsSection = 'accounts' | 'calendars';

/** One problem that the plugin found while it read the settings. */
export type SettingsProblem =
	/** The settings are not a set of named fields. */
	| { readonly kind: 'not-a-map' }
	/** A section holds a value that is not a list of entries. */
	| { readonly kind: 'section-not-a-list'; readonly section: SettingsSection }
	/** An entry of a section is not a set of named fields. */
	| {
			readonly kind: 'entry-not-a-map';
			readonly section: SettingsSection;
			readonly index: number;
	  }
	/** A field of an entry holds a value that the plugin refuses. */
	| {
			readonly kind: 'entry-field';
			readonly section: SettingsSection;
			readonly index: number;
			/** The name of the entry, or null where the name is not readable. */
			readonly name: string | null;
			readonly fault: FieldFault;
	  };

/** The words that name one field to the user. */
const FIELD_LABELS: Readonly<Record<EntryField, string>> = {
	id: 'account id',
	serverUrl: 'server URL',
	username: 'username',
	credentialType: 'credential type',
	credentialRef: 'credential reference',
	password: 'app password',
	name: 'name',
	source: 'source',
	accountId: 'account',
	collectionHref: 'collection address',
	mode: 'ownership mode',
	components: 'component types',
	defaultTimezone: 'default timezone',
	color: 'color',
};

/** The words that name one section to the user. */
const SECTION_LABELS: Readonly<Record<SettingsSection, string>> = {
	accounts: 'accounts',
	calendars: 'calendars',
};

/** The words that state one problem to the user. */
export function describeSettingsProblem(problem: SettingsProblem): string {
	switch (problem.kind) {
		case 'not-a-map':
			return 'The data file holds settings of another shape. The plugin starts with empty settings.';
		case 'section-not-a-list':
			return `The settings hold the ${SECTION_LABELS[problem.section]} as a value that is not a list. The plugin reads no entry there.`;
		case 'entry-not-a-map':
			return `${refusal(problem.section, problem.index, null)} That entry is not a set of fields.`;
		case 'entry-field':
			return `${refusal(problem.section, problem.index, problem.name)} ${describeFieldFault(problem.fault)}`;
	}
}

/** The words that state one fault of one field to the user. */
export function describeFieldFault(fault: FieldFault): string {
	const field = quote(FIELD_LABELS[fault.field]);
	switch (fault.kind) {
		case 'missing':
			return `The entry has no field ${field}. Add that field.`;
		case 'not-text':
			return `The field ${field} holds a value that is not text. Write text there.`;
		case 'empty':
			return `The field ${field} holds no characters. Give that field a value.`;
		case 'not-a-list':
			return `The field ${field} holds a value that is not a list. Write a list there.`;
		case 'unknown-value':
			return `The field ${field} holds ${quote(fault.value)}. That field takes one of these values: ${fault.permitted.join(', ')}.`;
		case 'not-a-web-address':
			return `The field ${field} holds ${quote(fault.value)}. Write a web address that starts with https:// or http://.`;
		case 'alphabet':
			return `The field ${field} holds ${quote(fault.value)}. That field takes lowercase letters, digits, and dashes.`;
		case 'repeated':
			return `The field ${field} holds ${quote(fault.value)}. Another entry holds that value. Give each entry a value of its own.`;
	}
}

/** The words that name the entry that the plugin did not read. */
function refusal(
	section: SettingsSection,
	index: number,
	name: string | null,
): string {
	const entry =
		name === null
			? `entry ${String(index + 1)} of the ${SECTION_LABELS[section]}`
			: `${entrySingular(section)} ${quote(name)}`;
	return `Davenport did not read ${entry}.`;
}

function entrySingular(section: SettingsSection): string {
	return section === 'accounts' ? 'the account' : 'the calendar';
}

function quote(text: string): string {
	return `"${text}"`;
}
