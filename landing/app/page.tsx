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

type ToolDescription = {
  name: string;
  description: string;
};

export default async function Home() {
  let packageVersion: number | undefined;
  let tools: ToolDescription[] | undefined;

  try {
    const packageJson = await fs.readFile('../package.json', 'utf-8');
    packageVersion = JSON.parse(packageJson).version;

    const toolsJson = await fs.readFile('./tools.json', 'utf-8');
    tools = JSON.parse(toolsJson) as ToolDescription[];
  } catch (error) {
    console.error(error);
  }

  return (
    <div className="flex flex-col items-center min-h-screen p-4 sm:p-8">
      <main className="w-full max-w-3xl">
        <article>
          <header className="flex items-center justify-between gap-2 mb-8">
            <div className="flex items-baseline gap-2">
              <h1 className="text-3xl font-bold whitespace-nowrap">Neon MCP</h1>{' '}
              version: {packageVersion}
            </div>
            <Button asChild>
              <a
                href="https://github.com/neondatabase-labs/mcp-server-neon?tab=readme-ov-file"
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
                        <AccordionContent>{description}</AccordionContent>
                      </li>
                    </AccordionItem>
                  ))}
                </ul>
              </Accordion>
            )}
          </section>
        </article>
      </main>
      <footer>Footer</footer>
    </div>
  );
}
