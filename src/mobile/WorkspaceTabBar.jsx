import { Menu } from 'lucide-react'

const go = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }

/**
 * Bottom tab bar for the partner, rider and admin workspaces on phones.
 * Four destinations plus "More", which opens the existing side menu as a sheet.
 * Hidden on larger screens by mobileApp.css.
 */
export function WorkspaceTabBar({ items, path, onMore, label }) {
  return <nav className="ws-tabbar" aria-label={label}>
    {items.map(({ label: name, href, icon: Icon, match }) => {
      const active = match ? match(path) : path === href
      return <a key={href} href={href} className={active ? 'is-active' : undefined} aria-current={active ? 'page' : undefined} onClick={(event) => { event.preventDefault(); go(href) }}>
        <Icon size={20} aria-hidden="true" /><span>{name}</span>
      </a>
    })}
    <button type="button" onClick={onMore}><Menu size={20} aria-hidden="true" /><span>More</span></button>
  </nav>
}
