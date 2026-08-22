add_executable(selfrelay-whisper selfrelay-whisper.cpp)
target_link_libraries(selfrelay-whisper PRIVATE whisper)
target_compile_features(selfrelay-whisper PRIVATE cxx_std_17)

target_link_options(selfrelay-whisper PRIVATE
  "--bind"
  "-sMODULARIZE=1"
  "-sEXPORT_ES6=1"
  "-sEXPORT_NAME=createSelfRelayWhisperModule"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sINITIAL_MEMORY=134217728"
  "-sMAXIMUM_MEMORY=536870912"
  "-sFILESYSTEM=1"
  "-sENVIRONMENT=worker"
  "-sEXPORTED_RUNTIME_METHODS=['FS_createDataFile','FS_unlink']"
)
set_target_properties(selfrelay-whisper PROPERTIES SUFFIX ".js")
