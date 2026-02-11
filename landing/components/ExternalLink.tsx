import { ReactNode } from "react";

import { ExternalIcon } from "@/components/ExternalIcon";

type ExternalLinkProps = { href: string; children?: ReactNode };

export const ExternalLink = ({ href, children }: ExternalLinkProps) => (
  <a
    className="inline-flex items-center gap-1 w-fit external-link"
    href={href}
    target="_blank"
    rel="noopener noreferrer"
  >
    {children}
    <ExternalIcon />
  </a>
);
