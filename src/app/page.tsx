import { MareaApp } from '@/components/app/MareaApp';
import { parseView } from '@/lib/navigation';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const initialView = parseView(params.view);
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const initialQuery = initialView === 'search' ? rawQuery ?? '' : '';
  return <MareaApp initialView={initialView} initialQuery={initialQuery} />;
}
