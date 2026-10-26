const range = {
  type: 'object',
  additionalProperties: false,
  required: ['min', 'max'],
  properties: { min: { type: 'number' }, max: { type: 'number' } },
};
const exploration = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'description',
    'controls',
    'plots',
    'readouts',
    'xRange',
    'yRange',
  ],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    controls: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'label', 'min', 'max', 'step', 'value'],
        properties: {
          name: { type: 'string' },
          label: { type: 'string' },
          min: { type: 'number' },
          max: { type: 'number' },
          step: { type: 'number' },
          value: { type: 'number' },
        },
      },
    },
    plots: { type: 'array', maxItems: 3, items: { type: 'string' } },
    readouts: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'expression'],
        properties: {
          label: { type: 'string' },
          expression: { type: 'string' },
        },
      },
    },
    xRange: range,
    yRange: range,
  },
};
export const presentationSchema = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'content'],
      properties: {
        action: { type: 'string', enum: ['show', 'hide'] },
        content: { anyOf: [{ type: 'null' }, exploration] },
      },
    },
  ],
};
