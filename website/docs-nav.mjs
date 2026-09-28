// Documentation navigation: tabs, sidebar groups and an icon per page (Lucide icon names).
// Pages not listed here still build; they're added to a "More" group in the matching tab.

export const TABS = [
  {
    id: 'guides',
    label: 'Guides',
    home: 'README.md',
    groups: [
      ['Get started', [['README.md', 'house', 'Overview'], ['guides/first-voice.md', 'rocket'], ['guides/desktop.md', 'monitor-down'], ['guides/models.md', 'boxes'], ['guides/settings.md', 'settings']]],
      ['Create', [
        ['guides/studio.md', 'audio-lines'], ['guides/script-markup.md', 'pen-line'], ['guides/quick-speak.md', 'zap'], ['guides/clone.md', 'copy'],
        ['guides/design.md', 'wand-sparkles'], ['guides/dub.md', 'film'], ['guides/stories-audiobooks.md', 'book-open'], ['guides/transcribe.md', 'mic'],
        ['guides/dictation.md', 'keyboard'],
      ]],
      ['Organize', [
        ['guides/voices.md', 'library'], ['guides/history.md', 'history'], ['guides/editor.md', 'scissors'], ['guides/compare.md', 'scale'],
        ['guides/collections.md', 'hash'], ['guides/projects.md', 'folder-kanban'], ['guides/batch.md', 'layers'], ['guides/activity.md', 'activity'],
      ]],
      ['Tools & automation', [['guides/tools.md', 'wrench'], ['guides/drop-anywhere.md', 'upload'], ['guides/finder-shortcuts.md', 'folder-open'], ['guides/integrations.md', 'plug']]],
    ],
  },
  {
    id: 'api',
    label: 'API',
    home: 'api/overview.md',
    groups: [
      ['Get started', [['api/overview.md', 'book-marked'], ['api/quickstart.md', 'rocket'], ['api/authentication.md', 'key-round'], ['api/errors.md', 'shield-alert']]],
      ['Connect', [['api/reference/openai.md', 'braces'], ['api/reference/mcp.md', 'bot'], ['api/reference/keys.md', 'key']]],
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    home: 'api/reference/speech.md',
    groups: [
      ['Speech & voices', [
        ['api/reference/speech.md', 'audio-lines'], ['api/reference/voices.md', 'library'], ['api/reference/custom-voices.md', 'users'],
        ['api/reference/design.md', 'wand-sparkles'], ['api/reference/engines.md', 'audio-waveform'], ['api/reference/models.md', 'boxes'],
      ]],
      ['Audio & text', [
        ['api/reference/transcription.md', 'file-audio'], ['api/reference/dubbing.md', 'film'], ['api/reference/books.md', 'book-open'],
        ['api/reference/tools.md', 'sparkles'], ['api/reference/takes.md', 'history'],
      ]],
      ['Organize', [['api/reference/projects.md', 'folder-kanban'], ['api/reference/tags.md', 'tags'], ['api/reference/compare.md', 'trophy'], ['api/reference/batch.md', 'layers']]],
      ['System', [['api/reference/jobs.md', 'list-checks'], ['api/reference/events.md', 'radio'], ['api/reference/settings.md', 'sliders-horizontal'], ['api/reference/system.md', 'hard-drive']]],
    ],
  },
]

/** Which tab a page belongs to when it isn't listed above. */
export const tabFor = (rel) => (rel.startsWith('api/reference/') ? 'reference' : rel.startsWith('api/') ? 'api' : 'guides')
