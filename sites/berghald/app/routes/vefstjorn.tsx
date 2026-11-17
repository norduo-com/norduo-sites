import { Vefstjorn } from '@norduo/cms/admin'

import cms from '../../cms.config'
import type { Route } from './+types/vefstjorn'

export function meta(_: Route.MetaArgs) {
  return [{ title: 'Vefstjórn Berghalds' }, { name: 'robots', content: 'noindex' }]
}

export default function Admin() {
  return <Vefstjorn config={cms} />
}
