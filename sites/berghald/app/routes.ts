import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('spike', 'routes/spike.tsx'),
  route('vefstjorn/*', 'routes/vefstjorn.tsx'),
] satisfies RouteConfig
