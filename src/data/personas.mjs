// Persona catalog. Each persona has:
//   - id:      stable key used in localStorage and data-attributes
//   - name:    display name
//   - lede:    one-line framing shown in the picker
//   - focus:   short phrase for the header badge ("thinking like a developer")
export const personas = [
  {
    id: 'designer',
    name: 'Designer',
    lede: "You're shaping what people see, tap, and feel.",
    focus: 'a designer',
  },
  {
    id: 'developer',
    name: 'Developer',
    lede: "You ship the code that makes interactions hold up under real conditions.",
    focus: 'a developer',
  },
  {
    id: 'product-manager',
    name: 'Product manager',
    lede: "You decide what gets built, for whom, and when.",
    focus: 'a product manager',
  },
  {
    id: 'researcher',
    name: 'UX researcher',
    lede: "You surface the lived experience of the people you're building for.",
    focus: 'a researcher',
  },
  {
    id: 'content-designer',
    name: 'Content designer',
    lede: "You write the words people lean on when things go wrong.",
    focus: 'a content designer',
  },
];

export const defaultPersonaId = 'designer';
