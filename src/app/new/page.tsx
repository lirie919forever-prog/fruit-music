import { MareaApp } from '@/components/app/MareaApp';
import { parseNavigation } from '@/lib/navigation';

export default async function NewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const viewValue = Array.isArray(params.view) ? params.view[0] : params.view;
  const queryValue = Array.isArray(params.q) ? params.q[0] : params.q;
  const sourceValue = Array.isArray(params.source) ? params.source[0] : params.source;
  const itemValue = Array.isArray(params.item) ? params.item[0] : params.item;
  const navigation = parseNavigation(
    new URLSearchParams({
      ...(viewValue ? { view: viewValue } : {}),
      ...(queryValue ? { q: queryValue } : {}),
      ...(sourceValue ? { source: sourceValue } : {}),
      ...(itemValue ? { item: itemValue } : {}),
    }),
  );

  return (
    <MareaApp
      initialView={viewValue ? navigation.view : 'new'}
      initialQuery={viewValue ? navigation.query : ''}
      initialItem={navigation.item}
      initialSearchSource={viewValue ? navigation.source : ''}
    />
  );
}
