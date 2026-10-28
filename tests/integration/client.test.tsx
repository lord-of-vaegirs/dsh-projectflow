import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import * as React from 'react'
import { apply, ProjectPanel } from '../../src/client/index.js'

describe('client plugin registration', () => {
  it('registers a footer action and a keyed main panel', () => {
    const registrations: Array<{ options: any; component: any }> = []
    const ctx: any = {
      connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
      slots: {
        inject: (_name: string, callback: () => unknown) => { callback() },
        register: (options: any, component: any) => {
          registrations.push({ options, component })
          return () => undefined
        },
      },
      locale: {
        register: () => undefined,
        bind: () => (key: string) => key,
      },
      layout: { selectPanel: () => undefined },
      uiWorkspace: { connectWorkspace: async () => undefined, openSession: () => undefined },
      workspaces: { list: { getSnapshot: () => ({ items: [] }) }, create: async () => ({ workspaceId: 'w', path: '/' }) },
      sessions: { list: { getSnapshot: () => ({ items: [] }) } },
      effect: (operation: () => unknown) => { operation() },
    }
    apply(ctx)
    expect(registrations.some((entry) => entry.options.name === 'sidebar.footer.action' && entry.options.id === 'projectflow')).toBe(true)
    expect(registrations.some((entry) => entry.options.name === 'main' && entry.options.key === 'projectflow')).toBe(true)
  })

  it('renders the panel shell', () => {
    const api: any = { list: async () => ({ projects: [], invalid: [] }) }
    const html = renderToStaticMarkup(React.createElement(
      ProjectPanel,
      { api, t: (key: string) => key },
    ))
    expect(html).toContain('panel.title')
    expect(html).toContain('panel.create')
  })
})
