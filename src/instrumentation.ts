import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { logs } from '@opentelemetry/api-logs';
import { WinstonInstrumentation } from '@opentelemetry/instrumentation-winston';

// Create OTLP exporters
const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
    : 'http://3.108.206.237:4318/v1/traces',
});

const logExporter = new OTLPLogExporter({
  url: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || 'http://3.108.206.237:4318/v1/logs',
});

// Create resource with service name - Use resourceFromAttributes function
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'my-nestjs-app',
});
console.log('Resource attributes:', resource.attributes);
// Initialize Logger Provider with processor in constructor
const loggerProvider = new LoggerProvider({
  resource,
  processors: [
    new BatchLogRecordProcessor(logExporter),
  ],
});


// Register the logger provider globally
logs.setGlobalLoggerProvider(loggerProvider);

// Initialize Node SDK
const sdk = new NodeSDK({
  resource,
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Automatically instruments Express, HTTP, and other Node.js libraries
      "@opentelemetry/instrumentation-fs": {
        enabled: false, // Disable file system instrumentation if not needed
      },
    }),
    // Winston instrumentation for log correlation with traces
    new WinstonInstrumentation({
      logHook: (span, record) => {
        record["resource.service.name"] =
          process.env.OTEL_SERVICE_NAME || "my-express";
      },
    }),
  ],
});

// Start the SDK
try {
  sdk.start();
  console.log("OpenTelemetry instrumentation initialized successfully");
} catch (error) {
  console.error("Error initializing OpenTelemetry:", error);
}

// Handle graceful shutdown
process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .then(() => console.log("OpenTelemetry SDK shut down successfully"))
    .catch((error) =>
      console.error("Error shutting down OpenTelemetry:", error)
    )
    .finally(() => process.exit(0));
});

export { loggerProvider, sdk };