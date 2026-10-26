const words = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];
const number = (text: string) => {
  const index = words.indexOf(text.toLowerCase());
  return index < 0 ? text : String(index);
};
const token = `(?:\\d+|${words.join('|')})`;
// Normalize only numbered curve references, never equation operands or numeric
// homophones such as "for" and "to".
export function normalizeGraphReferences(text: string): string {
  return text
    .replace(
      new RegExp(
        `^(?:(?:find|calculate|read|show) )?area between (?:graphs?|curves?) (${token}) (?:and|with|&) (?:(?:graph|curve) )?(${token})( from .+)$`,
        'i',
      ),
      (_, first: string, second: string, bounds: string) =>
        `area between graphs ${number(first)} and ${number(second)}${bounds}`,
    )
    .replace(
      new RegExp(
        `^((?:(?:edit|change|remove|delete|cancel|play|hear|listen to|evaluate|trace|integral|total area|derivative of|add derivative of|slope of|normal of|add normal to|add tangent to|add secant to|shift|reflect|scale|table)|(?:find|read|show)(?: the)? (?:roots|intercepts|x[ -]intercepts|key points)(?: of| for)?) (?:graph|curve|expression) )(${token})\\b`,
        'i',
      ),
      (_, prefix: string, value: string) => prefix + number(value),
    )
    .replace(
      new RegExp(
        `^((?:find|show|read)(?: the)? intersections (?:of|between)(?: graphs?| curves?)? )(${token})( (?:and|with|&) (?:graph |curve )?)(${token})$`,
        'i',
      ),
      (_, prefix: string, first: string, separator: string, second: string) =>
        prefix + number(first) + separator + number(second),
    );
}
