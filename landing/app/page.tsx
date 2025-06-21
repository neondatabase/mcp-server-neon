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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minHeight: '100vh',
        padding: '1rem',
        paddingBottom: '0',
      }}
    >
      <main style={{ width: '100%', maxWidth: '48rem' }}>
        <article
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2.5rem',
          }}
        >
          <Header packageVersion={packageVersion} />
          <Introduction />
          <section id="tools">
            <h2
              style={{
                fontSize: '1.5rem',
                lineHeight: '2rem',
                fontWeight: '700',
                marginBottom: '0.5rem',
                borderBottom: '3px solid rgb(5 150 105)',
                width: 'fit-content',
                paddingBottom: '0.25rem',
                alignSelf: 'flex-start',
              }}
            >
              Available Tools
            </h2>
            {tools === undefined ? (
              <div>tools.json is not found</div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                {tools.map(({ name, description }) => (
                  <Accordion type="single" collapsible key={name}>
                    <AccordionItem value={name}>
                      <AccordionTrigger>
                        <h3
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '1.25rem',
                            lineHeight: '1.75rem',
                            fontWeight: 600,
                          }}
                        >
                          {name}
                        </h3>
                      </AccordionTrigger>
                      <AccordionContent>
                        <DescriptionItemsUi description={description} />
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ))}
              </div>
            )}
          </section>
        </article>
      </main>
      <footer
        style={{
          textAlign: 'center',
          width: '100%',
          padding: '1rem',
          marginTop: '2.5rem',
        }}
      >
        Neon Inc. 2025
      </footer>
    </div>
  );
}
