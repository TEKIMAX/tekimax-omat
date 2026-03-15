import { HomeLayout } from 'fumadocs-ui/layouts/home';
import Link from 'next/link';
import { Zap, Globe, Shield, Heart, Database } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { CustomCodeBlock } from '@/components/custom-code-block';
import { BrandLogo } from '@/components/brand-logo';

// Server component for syntax highlighting
async function Code({ code, lang, title }: { code: string; lang: string; title: string }) {
  const { codeToHtml } = await import('shiki');
  const html = await codeToHtml(code, {
    lang,
    theme: 'vesper' // Matches the dark aesthetic
  });

  return (
    <CustomCodeBlock
      title={title}
      lang={lang}
      className="text-xs lg:text-sm my-0"
      html={html}
    >
      {/* Fallback for non-JS */}
      <pre className="leading-relaxed">{code}</pre>
    </CustomCodeBlock>
  );
}

export default function HomePage() {
  return (
    <HomeLayout
      nav={{
        title: (
          <BrandLogo />
        ),
      }}
      links={[
        {
          text: 'Documentation',
          url: '/docs',
          active: 'nested-url',
        },
        {
          text: 'Website',
          url: 'https://tekimax.com',
        },
        {
          text: 'GitHub',
          url: 'https://github.com/TEKIMAX/tekimax-omat',
        },
      ]}
    >
      <main className="flex flex-col min-h-screen bg-background text-foreground font-mono">

        {/* Bordered Layout Container */}
        <div className="border-x border-border max-w-7xl mx-auto w-full min-h-screen flex flex-col">

          {/* Hero Section - Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 border-b border-border">

            {/* Left: Branding & Value Prop */}
            <div className="p-12 lg:p-24 flex flex-col justify-center border-b lg:border-b-0 lg:border-r border-border">
              <div className="mb-8 inline-flex">
                <span className="inline-block border border-foreground px-3 py-1 text-xs font-bold uppercase tracking-wider">
                  v0.4.1 Latest
                </span>
              </div>

              <h1 className="text-5xl lg:text-7xl font-bold tracking-tighter mb-8 leading-[0.9]">
                <span className="bg-foreground text-green-400">OPEN</span><br />
                <span className="bg-foreground text-blue-400">MULTIMODAL</span><br />
                <span className="bg-foreground text-purple-400">ASSESSMENT</span><br />
                <span className="bg-foreground text-orange-400">TOOLKIT.</span>
              </h1>

              <p className="text-lg text-muted-foreground mb-12 max-w-md leading-relaxed">
                <span className="font-mono text-green-400 font-bold">[<span className="bg-foreground text-purple-400">OMAT</span>]</span> Open-source AI infrastructure for organizations building software for good — education, workforce development, nonprofits, civic tech, and healthcare. Built on <span className="font-bold text-foreground">tekimax-omat</span>.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href="/docs/core"
                  className="inline-flex h-14 items-center justify-center bg-foreground text-background px-8 text-base font-bold uppercase tracking-wide hover:bg-foreground/90 transition-colors"
                >
                  Read Docs -&gt;
                </Link>
                <a
                  href="https://github.com/TEKIMAX/tekimax-omat"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-14 items-center justify-center border border-border bg-background px-8 text-base font-bold uppercase tracking-wide hover:bg-muted transition-colors"
                >
                  GitHub
                </a>
              </div>
            </div>

            {/* Right: Technical Preview */}
            <div className="bg-muted/10 p-12 lg:p-24 flex flex-col justify-center relative overflow-hidden">
              {/* Background Blur/Glow */}
              <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[120px] translate-y-1/2 -translate-x-1/2 pointer-events-none" />
              {/* Install Command */}
              <div className="mb-12">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">
                   // INSTALLATION
                </p>
                <div className="flex items-center justify-between border border-border bg-background p-4">
                  <div className="font-mono text-sm">
                    <span className="text-green-600 mr-4">➜</span>
                    npm install tekimax-omat
                  </div>
                  <CopyButton text="npm install tekimax-omat" />
                </div>
              </div>

              {/* Code Snippet */}
              <div>
                <Code
                  title="USAGE_PREVIEW.TS"
                  lang="typescript"
                  code={`import { Tekimax, AnthropicProvider } from 'tekimax-omat';

const client = new Tekimax({
  provider: new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY
  })
});

for await (const chunk of client.text.chat.completions.createStream({
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'Hello' }],
})) {
  process.stdout.write(chunk.delta);
}`}
                />
              </div>
            </div>
          </div>


          {/* OMAT Section */}
          <div className="border-b border-border p-12 lg:p-24">
            <div className="max-w-4xl mx-auto">
              <div className="mb-2 inline-flex gap-3">
                <span className="inline-block border border-green-600 text-green-600 px-3 py-1 text-xs font-bold uppercase tracking-wider">
                  Open Source
                </span>
                <span className="inline-block border border-border px-3 py-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Apache 2.0
                </span>
              </div>

              <h2 className="text-3xl lg:text-4xl font-bold uppercase tracking-tighter mb-4">
                OMAT — Open Multimodal<br />Assessment Toolkit
              </h2>
              <p className="text-muted-foreground max-w-2xl leading-relaxed mb-12">
                An open-source framework for any organization building AI-powered formative assessments — K–12 programs, workforce development, nonprofit outcome measurement, healthcare education, and more. Accepts text, speech, drawing, and handwriting inputs.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-0 divide-y md:divide-y-0 md:divide-x divide-border border border-border">
                <div className="p-8">
                  <div className="text-green-600 text-xs font-bold uppercase tracking-wider mb-3">01</div>
                  <h3 className="font-bold uppercase tracking-wide mb-3">Assessment Pipeline SDK</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Configurable rubric schemas, feedback pipelines, and model-agnostic evaluation interfaces. Embeddable with a single <code className="text-green-600 bg-green-600/10 px-1 py-0.5 text-xs">npm install</code>.
                  </p>
                </div>
                <div className="p-8">
                  <div className="text-blue-500 text-xs font-bold uppercase tracking-wider mb-3">02</div>
                  <h3 className="font-bold uppercase tracking-wide mb-3">Benchmark Suite</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Standardized evaluation measuring accuracy of knowledge diagnosis, learning progression alignment, fairness across subgroups, and actionability.
                  </p>
                </div>
                <div className="p-8">
                  <div className="text-purple-500 text-xs font-bold uppercase tracking-wider mb-3">03</div>
                  <h3 className="font-bold uppercase tracking-wide mb-3">Multimodal Dataset</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    De-identified student work across written, spoken, and drawn modalities — annotated by expert educators. Aligned to Common Core and NGSS. Licensed CC-BY-4.0.
                  </p>
                </div>
              </div>

              <div className="mt-8 border border-amber-600/30 bg-amber-600/5 p-6">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  <span className="text-amber-600 font-bold uppercase tracking-wider text-xs">Equity-Centered by Design</span> — OMAT centers multilingual learners, individuals with disabilities, and communities that need it most. Multimodal inputs like speech and drawing ensure anyone who can&apos;t yet express ideas in writing can still demonstrate what they know.
                </p>
              </div>

              <p className="mt-6 text-xs text-muted-foreground">
                OMAT follows the vision set forward by{' '}
                <a href="https://digitalpromise.org" target="_blank" rel="noreferrer" className="underline hover:text-foreground transition-colors">
                  Digital Promise
                </a>
                {' '}and the{' '}
                <a href="https://k12-ai-infrastructure.org/faq-march-8th-rfp/" target="_blank" rel="noreferrer" className="underline hover:text-foreground transition-colors">
                  K-12 AI Infrastructure Program
                </a>
                {' '}— their proposal inspired OMAT&apos;s mission: that AI-powered assessment deserves shared, open infrastructure, and that vision extends beyond K–12 to any sector where feedback quality and equity matter.
              </p>
            </div>
          </div>

          {/* Features Grid - Brutalist grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 divide-y md:divide-y-0 md:divide-x border-border divide-border border-b">
            {FEATURES.map((feature, i) => (
              <div key={i} className="p-8 group hover:bg-muted/30 transition-colors">
                <feature.icon className="w-8 h-8 mb-6 stroke-1" />
                <h3 className="font-bold uppercase tracking-wide mb-3">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>

          {/* Sponsor Section */}
          <div className="border-b border-border p-12 lg:p-24 text-center bg-muted/5">
            <h2 className="text-3xl font-bold uppercase tracking-tighter mb-6">
              Support the Development
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
              Tekimax is open source and free to use. If you find it valuable for your startup or enterprise, considering becoming a sponsor to ensure long-term sustainability.
            </p>
            <a
              href="https://github.com/sponsors/TEKIMAX"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center justify-center bg-pink-600 text-white px-8 text-sm font-bold uppercase tracking-wide hover:bg-pink-700 transition-colors rounded-none"
            >
              <Heart className="w-4 h-4 mr-2 fill-current" />
              Become a Sponsor
            </a>
          </div>

          {/* Footer Stinger */}
          <div className="p-8 text-center bg-foreground text-background">
            <p className="font-mono text-xs uppercase tracking-widest">
              Built by Tekimax • Type-Safe by Default
            </p>
          </div>

        </div>
      </main>
    </HomeLayout>
  );
}

const FEATURES = [
  {
    title: 'Universal API',
    description: 'One interface for all providers. Switch from OpenAI to Ollama with a single config change.',
    icon: Globe,
  },
  {
    title: 'Type Safety',
    description: 'End-to-end TypeScript support. Zod schemas for runtime validation of every request/response.',
    icon: Shield,
  },
  {
    title: 'Zero Latency',
    description: 'Lightweight adapter pattern with zero runtime overhead. Direct passthrough performance.',
    icon: Zap,
  },
  {
    title: 'Zero CVEs',
    description: 'Hardened supply chain. Built on Chainguard\'s secure Node.js runtime and continuously scanned by Trivy for zero vulnerabilities.',
    icon: Shield,
  },
  {
    title: 'Edge Caching',
    description: 'Built-in Redis utilities for response caching, rate limiting, and exact token budgets.',
    icon: Database,
  },
];
