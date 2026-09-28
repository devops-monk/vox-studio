import {
  AudioLines,
  BookOpen,
  Boxes,
  Scissors,
  Scale,
  Code2,
  Copy,
  Film,
  FolderKanban,
  History,
  House,
  Layers,
  Library,
  Mic,
  Plug,
  Settings,
  Sparkles,
  Wand2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  description: string
  /** Milestone in plan.md that implements this page. */
  milestone: string
  keywords?: string[]
}

export interface NavSection {
  title?: string
  items: NavItem[]
}

export const NAV: NavSection[] = [
  {
    items: [
      { path: '/', label: 'Home', icon: House, description: 'Start something new or pick up where you left off.', milestone: 'M0' },
    ],
  },
  {
    title: 'Create',
    items: [
      { path: '/studio', label: 'Studio', icon: AudioLines, description: 'Write a script and bring it to life with any voice.', milestone: 'M4', keywords: ['tts', 'generate', 'speak'] },
      { path: '/clone', label: 'Clone', icon: Copy, description: 'Create a voice from a few seconds of audio.', milestone: 'M4', keywords: ['reference', 'record'] },
      { path: '/design', label: 'Design', icon: Wand2, description: 'Describe a voice in words and shape it with sliders.', milestone: 'M6' },
      { path: '/dub', label: 'Dub', icon: Film, description: 'Translate and re-voice any video.', milestone: 'M9', keywords: ['video', 'translate'] },
      { path: '/stories', label: 'Stories', icon: Sparkles, description: 'Multi-voice stories with a cast of characters.', milestone: 'M10' },
      { path: '/audiobook', label: 'Audiobook', icon: BookOpen, description: 'Turn books into chaptered audiobooks.', milestone: 'M10', keywords: ['epub', 'longform'] },
      { path: '/transcribe', label: 'Transcribe', icon: Mic, description: 'Transcribe files, or dictate into any app.', milestone: 'M8', keywords: ['asr', 'dictation', 'speech to text'] },
    ],
  },
  {
    title: 'Library',
    items: [
      { path: '/voices', label: 'Voices', icon: Library, description: 'Your voices, presets and consent records.', milestone: 'M5', keywords: ['library', 'saved', 'gallery'] },
      { path: '/editor', label: 'Editor', icon: Scissors, description: 'Trim, splice and polish takes on a timeline.', milestone: 'M19', keywords: ['edit', 'trim', 'cut', 'splice', 'fade', 'gain'] },
      { path: '/compare', label: 'Compare', icon: Scale, description: 'Blind-test voices to find the one you prefer.', milestone: 'M20', keywords: ['ab', 'blind', 'rating', 'best voice', 'leaderboard'] },
      { path: '/history', label: 'History', icon: History, description: 'Every take you have generated.', milestone: 'M7', keywords: ['takes'] },
      { path: '/projects', label: 'Projects', icon: FolderKanban, description: 'Group renders, dubs and books.', milestone: 'M12' },
      { path: '/batch', label: 'Batch', icon: Layers, description: 'Queue many jobs and watch folders.', milestone: 'M11', keywords: ['queue'] },
    ],
  },
  {
    title: 'More',
    items: [
      { path: '/models', label: 'Models', icon: Boxes, description: 'Download and manage voice models.', milestone: 'M3', keywords: ['download', 'kokoro', 'engines'] },
      { path: '/tools', label: 'Tools', icon: Wrench, description: 'Clean up recordings, change a voice, fix pronunciation.', milestone: 'M13', keywords: ['convert', 'pronunciation', 'denoise', 'normalize', 'loudness', 'speech to speech'] },
      { path: '/integrations', label: 'Integrations', icon: Plug, description: 'Connect AI agents, editors, automations and OpenAI SDKs.', milestone: 'M14', keywords: ['mcp', 'claude', 'cursor', 'n8n', 'openai'] },
      { path: '/developer', label: 'Developer', icon: Code2, description: 'API keys and an interactive API explorer.', milestone: 'M14', keywords: ['api', 'keys', 'token', 'curl', 'openapi'] },
    ],
  },
]

export const SETTINGS_ITEM: NavItem = {
  path: '/settings',
  label: 'Settings',
  icon: Settings,
  description: 'Models, performance, storage, privacy and more.',
  milestone: 'M15',
  keywords: ['preferences'],
}

export const ALL_NAV_ITEMS: NavItem[] = [...NAV.flatMap((s) => s.items), SETTINGS_ITEM]
