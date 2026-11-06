import type { ComponentProps } from 'react';
import { Logo } from '@ki4jlu/design-system';
import { appNameFrom } from '../utils/appName';

interface AppLogoProps {
  siteConfigs: Record<string, string> | null | undefined;
  size: ComponentProps<typeof Logo>['size'];
}

/** The app's wordmark: the design system's `Logo` with the configured name (appNameFrom). */
export function AppLogo({ siteConfigs, size }: AppLogoProps) {
  const { prefix, product } = appNameFrom(siteConfigs);
  return <Logo prefix={prefix} product={product} size={size} />;
}
