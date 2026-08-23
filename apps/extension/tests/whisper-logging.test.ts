import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const wrapperPath=resolve(here,'../../../tools/whisper/selfrelay-whisper.cpp');

test('packaged Whisper routes official upstream log levels without hiding genuine errors',async()=>{
  const source=await readFile(wrapperPath,'utf8');
  assert.match(source,/whisper_log_set\(selfrelay_whisper_log, nullptr\)/);
  assert.match(source,/case GGML_LOG_LEVEL_ERROR:\s*emscripten_console_error\(text\)/s);
  assert.match(source,/case GGML_LOG_LEVEL_WARN:\s*emscripten_console_warn\(text\)/s);
  assert.match(source,/case GGML_LOG_LEVEL_INFO:[\s\S]*emscripten_console_log\(text\)/);
  assert.match(source,/level == GGML_LOG_LEVEL_CONT/);
  assert.doesNotMatch(source,/console\.error\s*=|GGML_LOG_LEVEL_ERROR:[\s\S]{0,160}return;/);
  assert.ok(source.indexOf('configure_whisper_logging();')<source.indexOf('whisper_init_from_file_with_params('));
});
