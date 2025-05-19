import fs from 'fs/promises';
// import Image from 'next/image';

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
      <main className="max-w-3xl">
        <article>
          <header className="flex items-baseline gap-2 mb-4">
            <h1 className="text-2xl font-bold whitespace-nowrap">Neon MCP</h1>{' '}
            version: {packageVersion}
          </header>
          <section id="tools">
            <h2 className="text-2xl font-bold mb-2">Available Tools</h2>
            <ul className="flex flex-col gap-2">
              {tools === undefined ? (
                <div>tools.json is not found</div>
              ) : (
                tools.map(({ name, description }) => (
                  <li key={name}>
                    <h3 className="monospaced font-semibold">{name}</h3>
                    <div>{description}</div>
                  </li>
                ))
              )}
            </ul>
          </section>
        </article>
      </main>
      <footer>Footer</footer>
    </div>
  );
}
