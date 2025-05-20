import fs from 'fs/promises';
import Image from 'next/image';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';

import githubSvg from './github.svg';
import { DescriptionItem, parseDescription } from '@/lib/description';
import { DescriptionItemUi } from '@/components/DescriptionItem';
import { Introduction } from '@/components/Introduction';

type ToolDescription = {
  name: string;
  description: string;
};

export default async function Home() {
  let packageVersion: number | undefined;
  let tools:
    | {
        name: string;
        description: DescriptionItem[];
      }[]
    | undefined;

  try {
    const packageJson = await fs.readFile('../package.json', 'utf-8');
    packageVersion = JSON.parse(packageJson).version;

    const toolsJson = await fs.readFile('./tools.json', 'utf-8');
    const rawTools = JSON.parse(toolsJson) as ToolDescription[];

    tools = rawTools.map(({ description, ...data }) => ({
      ...data,
      description: parseDescription(description),
    }));
  } catch (error) {
    console.error(error);
  }

  return (
    <div className="flex flex-col items-center min-h-screen p-4 pb-0 sm:p-8 sm:pb-0">
      <main className="w-full max-w-3xl">
        <article className="flex flex-col gap-10">
          <header className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Image src="/neon.svg" width={30} height={30} alt="Neon logo" />
              <div className="flex items-baseline gap-2">
                <h1 className="text-3xl font-bold whitespace-nowrap">
                  Neon MCP
                </h1>{' '}
                version: {packageVersion}
              </div>
            </div>
            <Button asChild>
              <a
                href="https://github.com/neondatabase-labs/mcp-server-neon?tab=readme-ov-file"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Image
                  alt=""
                  src={githubSvg}
                  className="invert dark:invert-0"
                  width={16}
                  height={16}
                />{' '}
                Github
              </a>
            </Button>
          </header>
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
                          {description.map((item, index) => (
                            <DescriptionItemUi key={index} {...item} />
                          ))}
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
