import type { Metadata } from 'next';

import { PricingCalculator } from '@/components/pricing/pricing-calculator';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Precificador' };

export default function PricingCalculatorPage() {
  return (
    <>
      <PageHeader
        title="Precificador"
        subtitle="Descubra quanto cobrar pelos seus projetos em poucos segundos."
      />

      <PricingCalculator />
    </>
  );
}
