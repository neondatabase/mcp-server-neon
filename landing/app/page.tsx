import fs from 'fs/promises';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { parseDescription } from '@/lib/description';
import { DescriptionItemsUi } from '@/components/DescriptionItem';
import { Introduction } from '@/components/Introduction';
import { Header } from '@/components/Header';

type ToolDescription = {
  name: string;
  description: string;
};

export default async function Home() {
  const packageJson = await fs.readFile('../package.json', 'utf-8');
  const packageVersion = JSON.parse(packageJson).version as number;

  const toolsJson = await fs.readFile('./tools.json', 'utf-8');
  const rawTools = JSON.parse(toolsJson) as ToolDescription[];

  const tools = rawTools.map(({ description, ...data }) => ({
    ...data,
    description: parseDescription(description),
  }));

  return (
    <div className="flex flex-col items-center min-h-screen p-4 pb-0 sm:p-8 sm:pb-0">
      <main className="w-full max-w-3xl">
        <article className="flex flex-col gap-10">
          <Header packageVersion={packageVersion} />
          <Introduction />
          <section id="tools">
            <h2 className="text-2xl font-bold mb-2 border-b-3 border-b-emerald-600">
              Available Tools
            </h2>
            {tools === undefined ? (
              <div>tools.json is not found</div>
            ) : (
              <Accordion type="multiple" asChild>
                <ul>
                  {tools.map(({ name, description }) => (
                    <AccordionItem key={name} value={name} asChild>
                      <li key={name}>
                        <AccordionTrigger className="flex items-center">
                          <h3 className="monospaced text-xl font-semibold">
                            {name}
                          </h3>
                        </AccordionTrigger>
                        <AccordionContent>
                          <DescriptionItemsUi description={description} />
                        </AccordionContent>
                      </li>
                    </AccordionItem>
                  ))}
                </ul>
              </Accordion>
            )}
          </section>
        </article>
      </main>
      <footer className="text-center w-full p-4 mt-10">Neon Inc. 2025</footer>
    </div>
  );
}
