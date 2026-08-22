add_executable(selfrelay-whisper selfrelay-whisper.cpp)
target_link_libraries(selfrelay-whisper PRIVATE whisper)
target_compile_features(selfrelay-whisper PRIVATE cxx_std_17)

target_link_options(selfrelay-whisper PRIVATE
  "--bind"
  "-sMODULARIZE=1"
  "-sEXPORT_ES6=1"
  "-sEXPORT_NAME=createSelfRelayWhisperModule"
  "-sUSE_PTHREADS=1"
  "-sPTHREAD_POOL_SIZE=4"
  "-sPTHREAD_POOL_SIZE_STRICT=0"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sINITIAL_MEMORY=536870912"
  "-sMAXIMUM_MEMORY=2097152000"
  "-sFILESYSTEM=1"
  "-sENVIRONMENT=worker"
  "-sDYNAMIC_EXECUTION=0"
  "-sEMBIND_AOT=1"
  "-sASSERTIONS=1"
  "-sEXPORTED_RUNTIME_METHODS=['FS_createDataFile','FS_unlink']"
)
set_target_properties(selfrelay-whisper PROPERTIES SUFFIX ".js")
