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
import pkg from '../package.json';
import { NEON_TOOLS } from '../mcp-src/tools/definitions';

export default async function Home() {
  const packageVersion = pkg.version;

  const tools = NEON_TOOLS.map(({ name, description }) => ({
    name,
    description: parseDescription(description),
  }));

  return (
    <div className="flex flex-col items-center min-h-screen p-4 pb-0 sm:p-8 sm:pb-0">
      <main className="w-full max-w-3xl">
        <article className="flex flex-col gap-10">
          <Header packageVersion={packageVersion} />
          <Introduction />
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
            <div className="flex">
              <div className="ml-3">
                <p className="text-sm text-yellow-700">
                  <strong>Security Notice:</strong> The Neon MCP Server grants
                  powerful database management capabilities through natural
                  language requests. Please review our{' '}
                  <a
                    href="https://neon.tech/docs/ai/neon-mcp-server#mcp-security-guidance"
                    className="underline hover:text-yellow-800"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    MCP security guidance
                  </a>{' '}
                  before using.
                </p>
              </div>
            </div>
          </div>
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
