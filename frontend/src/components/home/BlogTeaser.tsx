import { Link } from "react-router";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { blogCards } from "@/content/blog";

function categoryLabel(tags: string[]): string {
  const tag = tags[0] ?? "Private Practice";
  return tag
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function BlogTeaser() {
  const posts = blogCards().slice(0, 3);
  if (posts.length === 0) return null;

  return (
    <section className="bg-white py-16 sm:py-24 lg:py-28" aria-label="Blog posts">
      <Container>
        <div className="mx-auto mb-14 max-w-md text-center">
          <span className="eyebrow">From the Blog</span>
          <h2 className="text-balance font-display text-3xl font-bold leading-[1.2] text-ink sm:text-4xl">
            Real talk about building your private practice.
          </h2>
          <div className="mx-auto mt-8 h-[3px] w-14 bg-gold" aria-hidden />
        </div>

        <RevealGroup className="mx-auto grid max-w-lg gap-7 lg:max-w-none lg:grid-cols-3">
          {posts.map((post) => (
            <RevealItem key={post.id}>
              <Link
                to={`/blog/${post.slug}`}
                className="group flex h-full flex-col border border-hairline"
              >
                <div className="aspect-[16/9] overflow-hidden">
                  <img
                    src={post.coverImage}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-plum">
                    {categoryLabel(post.tags)}
                  </span>
                  <h3 className="mt-2.5 font-display text-xl font-bold leading-tight text-ink">
                    {post.title}
                  </h3>
                  <p className="mt-2.5 flex-1 text-sm leading-relaxed text-ink-soft">
                    {post.excerpt}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-plum">
                    Read More <span aria-hidden>→</span>
                  </span>
                </div>
              </Link>
            </RevealItem>
          ))}
        </RevealGroup>

        <div className="mt-11 text-center">
          <Button to="/blog" variant="secondary" size="lg">
            Read All Posts
          </Button>
        </div>
      </Container>
    </section>
  );
}
