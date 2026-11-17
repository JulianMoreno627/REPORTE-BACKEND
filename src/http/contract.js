import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { ValidationError } from '../domain/errors.js';

const CONTRACT_URL = new URL('../../contracts/openapi.json', import.meta.url);
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export const contract = JSON.parse(readFileSync(CONTRACT_URL, 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(contract, 'contract');

const escape = (segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
const pointer = (...segments) => `contract#/${segments.map(escape).join('/')}`;

export const operations = Object.entries(contract.paths).flatMap(([path, item]) => METHODS
  .filter((method) => item[method])
  .map((method) => ({
    method: method.toUpperCase(),
    path,
    expressPath: path.replace(/\{(\w+)\}/g, ':$1'),
    operationId: item[method].operationId,
    operation: item[method],
  })));

const byId = new Map(operations.map((operation) => [operation.operationId, operation]));
const validators = new Map();

function find(operationId) {
  const operation = byId.get(operationId);
  if (!operation) throw new Error(`La operación ${operationId} no existe en el contrato`);
  return operation;
}

function compile(key, ref) {
  if (!validators.has(key)) validators.set(key, ajv.compile({ $ref: ref }));
  return validators.get(key);
}

export function requestValidator(operationId) {
  const { path, method, operation } = find(operationId);
  if (!operation.requestBody?.content?.['application/json']) return null;
  return compile(`${operationId}:request`, pointer('paths', path, method.toLowerCase(), 'requestBody', 'content', 'application/json', 'schema'));
}

export function responseValidator(operationId, status) {
  const { path, method, operation } = find(operationId);
  const response = operation.responses?.[status];
  if (!response) throw new Error(`El contrato no define la respuesta ${status} de ${operationId}`);
  const target = response.$ref
    ? `${response.$ref.replace('#/', 'contract#/')}/content/application~1json/schema`
    : pointer('paths', path, method.toLowerCase(), 'responses', status, 'content', 'application/json', 'schema');
  return compile(`${operationId}:${status}`, target);
}

const MESSAGES = {
  required: ({ params }) => `falta el campo «${params.missingProperty}»`,
  type: ({ params }) => `debe ser de tipo ${params.type}`,
  enum: ({ params }) => `debe ser uno de: ${params.allowedValues.join(', ')}`,
  minimum: ({ params }) => `debe ser mayor o igual a ${params.limit}`,
  maximum: ({ params }) => `debe ser menor o igual a ${params.limit}`,
  minLength: ({ params }) => `debe tener al menos ${params.limit} caracteres`,
  maxLength: ({ params }) => `admite máximo ${params.limit} caracteres`,
  minItems: ({ params }) => `debe tener al menos ${params.limit} elemento(s)`,
  maxItems: ({ params }) => `admite máximo ${params.limit} elementos`,
};

export function describeErrors(errors) {
  return (errors ?? []).map((error) => {
    const field = error.instancePath.replace(/^\//, '').replaceAll('/', '.') || 'cuerpo';
    const text = MESSAGES[error.keyword]?.(error) ?? error.message;
    return error.keyword === 'required' && field === 'cuerpo' ? text : `«${field}» ${text}`;
  });
}

export function contractDocsPage(specUrl) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${contract.info.title}: contrato</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css">
</head>
<body>
  <div id="docs"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script>SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: '#docs' });</script>
</body>
</html>`;
}

export function validateBody(operationId) {
  const validate = requestValidator(operationId);
  if (!validate) throw new Error(`${operationId} no tiene un cuerpo JSON en el contrato`);
  return (req, _res, next) => {
    if (validate(req.body ?? {})) return next();
    const problems = describeErrors(validate.errors);
    next(new ValidationError(`La petición no cumple el contrato de la API: ${problems[0]}`, { operationId, problems }));
  };
}
