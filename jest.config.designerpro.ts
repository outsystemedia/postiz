// DesignerPRO addition — not upstream Postiz code.
//
// The upstream root jest.config.ts calls @nx/jest's getJestProjects(), which
// requires a full Nx workspace graph (nx.json + per-project project.json
// files). This repo, as cloned, has neither — `pnpm test` as shipped
// discovers zero projects. Rather than reconstruct Nx's project graph just to
// test four new endpoints, this is a small, standalone Jest config scoped
// only to the DesignerPRO fork additions. Run via `pnpm test:designerpro-fork`.
import type { Config } from 'jest';

const config: Config = {
  displayName: 'designerpro-fork',
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/apps/backend/src/public-api/routes/v1/public.groups.controller.spec.ts',
    '<rootDir>/apps/backend/src/public-api/routes/v1/public.integrations.controller.designerpro.spec.ts',
    '<rootDir>/apps/backend/src/api/routes/no.auth.integrations.controller.designerpro.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.designerpro.spec.ts',
  ],
  moduleNameMapper: {
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$': '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/react/(.*)$': '<rootDir>/libraries/react-shared-libraries/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.base.json',
        isolatedModules: true,
      },
    ],
  },
};

export default config;
