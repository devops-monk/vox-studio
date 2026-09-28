import { createHashHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from './app-shell'
import { ALL_NAV_ITEMS } from './nav'
import { HomePage } from '@/features/home/home-page'
import { SettingsPage } from '@/features/settings/settings-page'
import { PlaceholderPage } from '@/features/placeholder/placeholder-page'
import { ModelsPage } from '@/features/models/models-page'
import { StudioPage } from '@/features/studio/studio-page'
import { ClonePage } from '@/features/clone/clone-page'
import { VoicesPage } from '@/features/voices/voices-page'
import { DesignPage } from '@/features/design/design-page'
import { HistoryPage } from '@/features/history/history-page'
import { TranscribePage } from '@/features/transcribe/transcribe-page'
import { DubPage } from '@/features/dub/dub-page'
import { AudiobookPage, StoriesPage } from '@/features/longform/longform-page'
import { BatchPage } from '@/features/batch/batch-page'
import { ProjectsPage } from '@/features/projects/projects-page'
import { ToolsPage } from '@/features/tools/tools-page'
import { EditorPage } from '@/features/editor/editor-page'
import { ComparePage } from '@/features/compare/compare-page'
import { DeveloperPage } from '@/features/developer/developer-page'
import { IntegrationsPage } from '@/features/integrations/integrations-page'

const rootRoute = createRootRoute({ component: AppShell })

// Real pages replace placeholders as milestones land.
const pages: Record<string, () => React.ReactNode> = {
  '/': HomePage,
  '/settings': SettingsPage,
  '/models': ModelsPage,
  '/studio': StudioPage,
  '/clone': ClonePage,
  '/voices': VoicesPage,
  '/design': DesignPage,
  '/history': HistoryPage,
  '/transcribe': TranscribePage,
  '/dub': DubPage,
  '/stories': StoriesPage,
  '/audiobook': AudiobookPage,
  '/batch': BatchPage,
  '/projects': ProjectsPage,
  '/tools': ToolsPage,
  '/editor': EditorPage,
  '/compare': ComparePage,
  '/developer': DeveloperPage,
  '/integrations': IntegrationsPage,
}

const routes = ALL_NAV_ITEMS.map((item) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: item.path,
    component: pages[item.path] ?? (() => <PlaceholderPage item={item} />),
  }),
)

export const router = createRouter({
  routeTree: rootRoute.addChildren(routes),
  history: createHashHistory(),
  defaultPreload: 'intent',
})
