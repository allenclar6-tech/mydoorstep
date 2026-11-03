import { Fragment } from 'react'
import { LAST_UPDATED, LEGAL_ENTITY } from './legalContent'
import './legal.css'

/** Turns **bold** in the legal text into <strong>. Everything else stays plain text (no HTML is ever injected). */
function Rich({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>)
}

/** Privacy Policy / Terms page: summary, contents, numbered sections. */
export function LegalDocument({ doc, related = [] }) {
  const jump = (id) => (event) => { event.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  return <article className="legal-doc">
    <p className="legal-updated">Last updated: <time>{LAST_UPDATED}</time></p>
    {doc.summary?.length > 0 && <section className="legal-summary" aria-label="In brief">
      <h2>In brief</h2>
      <ul>{doc.summary.map((point) => <li key={point}>{point}</li>)}</ul>
    </section>}
    <nav className="legal-toc" aria-label="Contents">
      <h2>Contents</h2>
      <ol>{doc.sections.map((section) => <li key={section.id}><a href={`#${section.id}`} onClick={jump(section.id)}>{section.heading}</a></li>)}</ol>
    </nav>
    {doc.sections.map((section, index) => <section className="legal-section" id={section.id} key={section.id}>
      <h2><span>{index + 1}.</span> {section.heading}</h2>
      {section.paragraphs?.map((text) => <p key={text}><Rich text={text} /></p>)}
      {section.list?.length > 0 && <ul>{section.list.map((text) => <li key={text}><Rich text={text} /></li>)}</ul>}
      {section.after?.map((text) => <p key={text}><Rich text={text} /></p>)}
    </section>)}
    <footer className="legal-foot">
      <p>Questions? Email <a href={`mailto:${LEGAL_ENTITY.email}`}>{LEGAL_ENTITY.email}</a> or use Help in the app.</p>
      {related.length > 0 && <p className="legal-related">{related.map(([label, href], index) => <Fragment key={href}>{index > 0 && ' · '}<a href={href}>{label}</a></Fragment>)}</p>}
    </footer>
  </article>
}
