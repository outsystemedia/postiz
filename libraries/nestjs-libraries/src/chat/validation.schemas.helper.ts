import {
  validationMetadatasToSchemas,
  targetConstructorToSchema,
} from 'class-validator-jsonschema';
import { ValidationTypes } from 'class-validator';
// @ts-ignore
import { defaultMetadataStorage } from 'class-transformer/cjs/storage';

// Keep the public type independent from openapi3-ts's physical install path.
// This matters in pnpm worktrees, where TypeScript otherwise emits TS2742
// while generating backend declarations from a shared node_modules tree.
export function getValidationSchemas(): Record<string, unknown> {
  return validationMetadatasToSchemas({
    classTransformerMetadataStorage: defaultMetadataStorage,
    additionalConverters: {
      [ValidationTypes.NESTED_VALIDATION]: (meta, options) => {
        if (typeof meta.target === 'function') {
          const typeMeta = options.classTransformerMetadataStorage
            ? options.classTransformerMetadataStorage.findTypeMetadata(
                meta.target,
                meta.propertyName
              )
            : null;
          if (typeMeta) {
            const childType = typeMeta.typeFunction();
            return targetConstructorToSchema(childType, options);
          }
        }
        return {};
      },
    },
  });
}
